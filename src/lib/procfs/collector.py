"""Dependency-free Linux collector. stdout is a gzip JSON response, never a log.

Adapted from the Astra candidate's pidfd/host-path implementation and the Opus
collectors. No listening TCP port, shell interpolation, or custom image build.
"""
import glob
import gzip
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

PROTOCOL = 2
HEARTBEAT = "/tmp/wtop-heartbeat"
PID_FILE = "/tmp/wtop-agent.pid"
HOST_ROOT = "/proc/1/root"
MAX_ARGV = 65536
SIGNALS = ("TERM", "KILL", "INT", "HUP", "STOP", "CONT", "USR1", "USR2")
CPU_KEYS = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal", "guest")
MEMORY_KEYS = {"MemTotal": "total", "MemFree": "free", "MemAvailable": "available",
               "Buffers": "buffers", "Cached": "cached", "Shmem": "shared",
               "SReclaimable": "reclaimable", "Dirty": "dirty", "SwapTotal": "swapTotal",
               "SwapFree": "swapFree", "SwapCached": "swapCached"}


def read(path, required=False):
    try:
        with open(path, encoding="utf-8", errors="replace") as stream:
            return stream.read()
    except OSError:
        if required:
            raise
        return ""


def host_path(root, path):
    """Resolve absolute symlinks against the host root (including NixOS chains)."""
    pending, resolved, links = path.split("/"), [], 0
    while pending:
        part = pending.pop(0)
        if part in ("", "."):
            continue
        if part == "..":
            if resolved:
                resolved.pop()
            continue
        candidate = root.rstrip("/") + "/" + "/".join(resolved + [part])
        if os.path.islink(candidate):
            links += 1
            if links > 40:
                raise OSError("Host symlink loop")
            target = os.readlink(candidate)
            if target.startswith("/"):
                resolved = []
            pending = target.split("/") + pending
        else:
            resolved.append(part)
    return root.rstrip("/") + "/" + "/".join(resolved)


def unescape_mount(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)


def mask(value):
    return "•" * min(max(len(value), 1), 24)


def censor_argv(argv):
    result, positional = [], False
    for index, argument in enumerate(argv):
        if index == 0:
            result.append(argument)
        elif positional:
            result.append(mask(argument))
        elif argument == "--":
            positional = True
            result.append(argument)
        elif argument.startswith("--"):
            flag, separator, value = argument.partition("=")
            result.append(flag + separator + (mask(value) if value else ""))
        elif len(argument) >= 2 and argument[0] == "-" and argument[1].isalpha():
            # A cluster and a fused value cannot reliably be distinguished.
            result.append(argument[:2] + (mask(argument[2:]) if len(argument) > 2 else ""))
        else:
            result.append(mask(argument))
    return result


def parse_process_stat(text, page_size):
    left, right = text.index("("), text.rindex(")")
    fields = text[right + 2:].split()
    return {"pid": int(text[:left].strip()), "comm": text[left + 1:right],
            "state": fields[0], "ppid": int(fields[1]),
            "ticks": int(fields[11]) + int(fields[12]), "priority": int(fields[15]),
            "nice": int(fields[16]), "threads": int(fields[17]), "startTicks": int(fields[19]),
            "rss": max(0, int(fields[21])) * page_size,
            "processor": int(fields[36]) if len(fields) > 36 else 0,
            "isKernelThread": bool(int(fields[6]) & 0x200000)}


def collect_processes(argv_mode, page_size, proc="/proc"):
    result = []
    for entry in os.scandir(proc):
        if not entry.name.isdigit():
            continue
        try:
            process = parse_process_stat(read(entry.path + "/stat", True), page_size)
            status = read(entry.path + "/status")
            for line in status.splitlines():
                fields = line.split()
                if fields[0] == "Uid:":
                    process["uid"] = int(fields[2])  # effective UID, not directory owner
                elif fields[0] == "VmRSS:":
                    process["rss"] = int(fields[1]) * 1024
            process["cmdline"] = []
            if argv_mode != "hidden":
                try:
                    with open(entry.path + "/cmdline", "rb") as stream:
                        raw = stream.read(MAX_ARGV)
                    args = (raw[:-1] if raw.endswith(b"\0") else raw).split(b"\0") if raw else []
                    argv = [argument.decode("utf-8", "replace") for argument in args]
                    process["cmdline"] = censor_argv(argv) if argv_mode == "censored" else argv
                except OSError:
                    pass
            for line in read(entry.path + "/io").splitlines():
                key, _, value = line.partition(":")
                if key in ("read_bytes", "write_bytes"):
                    process["readBytes" if key == "read_bytes" else "writeBytes"] = int(value.strip())
            cgroup = read(entry.path + "/cgroup")
            ids = re.findall(r"(?:^|[/:-])([a-f0-9]{64})(?:\.scope|[/\n]|$)", cgroup)
            if ids:
                process["containerId"] = ids[-1]
            units = re.findall(r"([^/\n]+\.(?:service|scope))", cgroup)
            if units:
                process["unit"] = units[-1]
            # Never combine data from different incarnations of the same PID.
            if parse_process_stat(read(entry.path + "/stat", True), page_size)["startTicks"] != process["startTicks"]:
                continue
            result.append(process)
        except (OSError, ValueError, IndexError):
            continue
    return result


def collect_cpu():
    counters, context_switches, running = {}, 0, 0
    for line in read("/proc/stat", True).splitlines():
        fields = line.split()
        if re.fullmatch(r"cpu[0-9]*", fields[0]):
            values = list(map(int, fields[1:]))
            counters[fields[0]] = {key: values[index] if index < len(values) else 0 for index, key in enumerate(CPU_KEYS)}
        elif fields[0] == "ctxt":
            context_switches = int(fields[1])
        elif fields[0] == "procs_running":
            running = int(fields[1])
    indices = [int(key[3:]) for key in counters if key != "cpu"]
    cpus = [counters.get("cpu" + str(index), dict.fromkeys(CPU_KEYS, 0)) for index in range(max(indices, default=0) + 1)]
    return counters["cpu"], cpus, context_switches, running


def collect_memory():
    memory = dict.fromkeys(MEMORY_KEYS.values(), 0)
    for line in read("/proc/meminfo", True).splitlines():
        key, _, data = line.partition(":")
        if key in MEMORY_KEYS:
            memory[MEMORY_KEYS[key]] = int(data.split()[0]) * 1024
    return memory


def collect_network():
    result = []
    for line in read("/proc/1/net/dev").splitlines():
        name, separator, body = line.rpartition(":")
        fields = body.split()
        if separator and len(fields) >= 16:
            result.append({"name": name.strip(), "rxBytes": int(fields[0]), "rxPackets": int(fields[1]),
                           "rxErrors": int(fields[2]), "txBytes": int(fields[8]),
                           "txPackets": int(fields[9]), "txErrors": int(fields[10])})
    return result


def collect_disks():
    result = []
    for line in read("/proc/diskstats").splitlines():
        fields = line.split()
        if len(fields) < 14:
            continue
        name = fields[2]
        base = "/sys/class/block/" + name
        if re.match(r"(?:loop|ram|zram)\d+$", name) or os.path.exists(base + "/partition"):
            continue
        result.append({"name": name, "reads": int(fields[3]), "readSectors": int(fields[5]),
                       "writes": int(fields[7]), "writeSectors": int(fields[9]), "ioMilliseconds": int(fields[12]),
                       # Show stacked devices, but count only leaves in host totals.
                       "aggregate": not bool(glob.glob(base + "/slaves/*"))})
    return result


FILESYSTEM_PROBE = """import json,os,sys
result=[]
for entry in json.loads(sys.argv[1]):
    try:
        stat=os.statvfs(entry.pop('path'))
        if stat.f_blocks:
            entry.update(size=stat.f_blocks*stat.f_frsize,free=stat.f_bfree*stat.f_frsize,available=stat.f_bavail*stat.f_frsize)
            result.append(entry)
    except OSError:
        pass
print(json.dumps(result))
"""


def filesystem_entries(text, root=HOST_ROOT):
    # Do not probe NFS, FUSE or automounts: statvfs can trigger network I/O or hang.
    local = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "bcachefs", "vfat", "exfat", "ntfs3", "f2fs", "erofs"}
    entries = []
    for line in text.splitlines():
        before, separator, after = line.partition(" - ")
        fields, fs = before.split(), after.split()
        if not separator or len(fields) < 6 or len(fs) < 2 or fs[0] not in local:
            continue
        mount = unescape_mount(fields[4])
        entries.append({"mount": mount, "device": unescape_mount(fs[1]), "type": fs[0], "identity": fields[2]})
    result, seen = [], set()
    for entry in sorted(entries, key=lambda item: (len(item["mount"]), item["mount"])):
        identity = entry.pop("identity")
        if identity in seen:
            continue
        seen.add(identity)
        try:
            entry["path"] = host_path(root, entry["mount"])
            result.append(entry)
        except OSError:
            pass
    return result


def collect_filesystems():
    entries = filesystem_entries(read("/proc/1/mountinfo"))
    if not entries:
        return []
    try:
        result = subprocess.run([sys.executable, "-I", "-c", FILESYSTEM_PROBE, json.dumps(entries)],
                                capture_output=True, timeout=2, check=True)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


def optional_number(path, scale=1):
    try:
        return int(read(path).strip()) / scale
    except ValueError:
        return None


def collect_hardware(sysroot="/sys"):
    sensors, fans, gpus, seen = [], [], [], set()
    for chip_path in sorted(glob.glob(sysroot + "/class/hwmon/hwmon*")):
        chip = read(chip_path + "/name").strip() or os.path.basename(chip_path)
        for path in sorted(glob.glob(chip_path + "/temp*_input")):
            value = optional_number(path, 1000)
            if value is not None and -40 < value < 200:
                sensors.append({"chip": chip, "id": os.path.basename(chip_path),
                                "label": read(path.replace("_input", "_label")).strip() or os.path.basename(path).replace("_input", ""), "celsius": value})
        for path in sorted(glob.glob(chip_path + "/fan*_input")):
            value = optional_number(path)
            if value is not None and value >= 0:
                fans.append({"chip": chip, "label": read(path.replace("_input", "_label")).strip() or os.path.basename(path).replace("_input", ""), "rpm": value})
    for card in sorted(glob.glob(sysroot + "/class/drm/card[0-9]*")):
        if not re.fullmatch(r"card[0-9]+", os.path.basename(card)):
            continue
        device = os.path.realpath(card + "/device")
        if device in seen or not os.path.isdir(device):
            continue
        seen.add(device)
        state = read(device + "/power/runtime_status").strip()
        gpu = {"card": os.path.basename(card), "device": device, "state": state or "unknown"}
        if state != "suspended":
            for key, file in (("busy", "gpu_busy_percent"), ("vramUsed", "mem_info_vram_used"), ("vramTotal", "mem_info_vram_total")):
                value = optional_number(device + "/" + file)
                if value is not None and value >= 0:
                    gpu[key] = value
        gpus.append(gpu)
    return sensors, fans, gpus


def collect_pressure():
    result = {}
    for resource in ("cpu", "memory", "io"):
        entry = {}
        for line in read("/proc/pressure/" + resource).splitlines():
            fields = line.split()
            if fields and fields[0] in ("some", "full"):
                entry[fields[0]] = {key: float(value) for key, value in (field.split("=", 1) for field in fields[1:])}
        if entry:
            result[resource] = entry
    return result


def sample(argv_mode="full"):
    if argv_mode not in ("full", "censored", "hidden"):
        raise ValueError("Invalid privacy mode")
    cpu, cpus, switches, running = collect_cpu()
    load = read("/proc/loadavg", True).split()
    users = {}
    try:
        for line in read(host_path(HOST_ROOT, "/etc/passwd")).splitlines():
            fields = line.split(":")
            if len(fields) >= 3 and fields[2].isdigit():
                users.setdefault(int(fields[2]), fields[0])
    except OSError:
        pass
    model, frequencies = None, []
    for line in read("/proc/cpuinfo").splitlines():
        key, _, value = line.partition(":")
        if model is None and key.strip() in ("model name", "Model", "Hardware"):
            model = value.strip()
        if key.strip() == "cpu MHz":
            try:
                frequencies.append(float(value.strip()))
            except ValueError:
                pass
    if not frequencies:
        frequencies = [value for path in glob.glob("/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq")
                       if (value := optional_number(path, 1000)) is not None]
    sensors, fans, gpus = collect_hardware()
    return {"clockTicks": os.sysconf("SC_CLK_TCK"), "bootId": read("/proc/sys/kernel/random/boot_id").strip(),
            "contextSwitches": switches, "cpu": cpu, "cpus": cpus, "cpuModel": model or "Linux CPU",
            "cpuFrequencies": frequencies, "memory": collect_memory(), "interfaces": collect_network(),
            "disks": collect_disks(), "filesystems": collect_filesystems(), "sensors": sensors, "fans": fans,
            "gpus": gpus, "pressure": collect_pressure(), "hostname": read("/proc/sys/kernel/hostname").strip(),
            "load": list(map(float, load[:3])), "tasks": {"running": running, "total": int(load[3].split("/")[1])},
            "uptime": float(read("/proc/uptime", True).split()[0]), "users": users,
            "processes": collect_processes(argv_mode, os.sysconf("SC_PAGE_SIZE"))}


def signal_process(request):
    pid, start, name = request.get("pid"), request.get("startTicks"), request.get("signal")
    if (type(pid) is not int or pid <= 1 or pid > 2147483647 or type(start) is not int or start < 0
            or start > 9007199254740991 or name not in SIGNALS):
        return {"ok": False, "error": "INVALID_ARGUMENT"}
    fd = None
    try:
        if pid in (os.getpid(), int(read(PID_FILE).strip() or "0")):
            return {"ok": False, "error": "PROTECTED_PROCESS"}
        # Open first, then validate start ticks. Never fall back to racy os.kill(pid).
        fd = os.pidfd_open(pid)
        current = parse_process_stat(read(f"/proc/{pid}/stat", True), os.sysconf("SC_PAGE_SIZE"))
        if current["startTicks"] != start:
            return {"ok": False, "error": "STALE_PROCESS"}
        own_cgroup, target_cgroup = read("/proc/self/cgroup"), read(f"/proc/{pid}/cgroup")
        if own_cgroup and own_cgroup == target_cgroup:
            return {"ok": False, "error": "PROTECTED_PROCESS"}
        signal.pidfd_send_signal(fd, getattr(signal, "SIG" + name))
        return {"ok": True}
    except (ProcessLookupError, FileNotFoundError):
        return {"ok": False, "error": "PROCESS_NOT_FOUND"}
    except PermissionError:
        return {"ok": False, "error": "PERMISSION_DENIED"}
    except (OSError, ValueError, AttributeError):
        return {"ok": False, "error": "SIGNAL_FAILED"}
    finally:
        if fd is not None:
            os.close(fd)


def renew_lease():
    temporary = HEARTBEAT + "." + str(os.getpid())
    with open(temporary, "w", encoding="ascii") as stream:
        stream.write(str(time.monotonic()))
    os.replace(temporary, HEARTBEAT)


def watchdog(lifetime):
    if type(lifetime) is not int or not 10 <= lifetime <= 86400:
        raise ValueError("Invalid lifetime")
    os.umask(0o077)
    with open(PID_FILE, "w", encoding="ascii") as stream:
        stream.write(str(os.getpid()))
    renew_lease()
    stop = threading.Event()
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, lambda *_: stop.set())
    while not stop.wait(1):
        try:
            if time.monotonic() - float(read(HEARTBEAT, True)) >= lifetime:
                return
        except (OSError, ValueError):
            return


def main():
    try:
        request = json.loads(sys.argv[1])
        if not isinstance(request, dict):
            raise ValueError()
        if request.get("action") == "watch":
            watchdog(request.get("lifetime", 120))
            return
        if request.get("action") == "sample":
            renew_lease()
            response = {"ok": True, "protocol": PROTOCOL, "snapshot": sample(request.get("argv", "full"))}
        elif request.get("action") == "signal":
            renew_lease()
            response = signal_process(request)
        else:
            response = {"ok": False, "error": "INVALID_ARGUMENT"}
    except Exception:
        # Raw OS errors may contain paths, process arguments or credentials.
        response = {"ok": False, "error": "COLLECTOR_FAILED"}
    sys.stdout.buffer.write(gzip.compress(json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode(), compresslevel=1, mtime=0))


if __name__ == "__main__":
    main()
