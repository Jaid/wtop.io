"""Synthetic fixtures plus disposable Linux-process tests; never store host snapshots."""
import builtins
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / "src/lib/procfs/collector.py"
spec = importlib.util.spec_from_file_location("collector", SOURCE)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def process_stat(pid=222, name="test ) (worker\nname", start=123, flags=0):
    fields = ["0"] * 50
    for index, value in {0: "S", 1: 1, 6: flags, 11: 50, 12: 20, 15: 20, 16: -3,
                         17: 2, 19: start, 21: 2, 36: 1}.items():
        fields[index] = str(value)
    return f"{pid} ({name}) " + " ".join(fields)


class ParsingTests(unittest.TestCase):
    def test_stat_handles_newlines_parentheses_and_page_size(self):
        parsed = collector.parse_process_stat(process_stat(), 65536)
        self.assertEqual(parsed["comm"], "test ) (worker\nname")
        self.assertEqual(parsed["ticks"], 70)
        self.assertEqual(parsed["rss"], 131072)
        self.assertEqual(parsed["startTicks"], 123)
        self.assertEqual(parsed["nice"], -3)
        self.assertEqual(parsed["processor"], 1)

    def test_kernel_thread_flag_is_independent_of_argument_visibility(self):
        parsed = collector.parse_process_stat(process_stat(flags=0x200000), 4096)
        self.assertTrue(parsed["isKernelThread"])
        self.assertFalse(collector.parse_process_stat(process_stat(), 4096)["isKernelThread"])

    def test_host_absolute_symlinks_stay_inside_host_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "etc").mkdir()
            (root / "nix/store").mkdir(parents=True)
            (root / "nix/store/passwd").write_text("synthetic-user", encoding="utf8")
            (root / "etc/passwd").symlink_to("/nix/store/passwd")
            path = collector.host_path(temporary, "/etc/passwd")
            self.assertEqual(Path(path).read_text(), "synthetic-user")
            self.assertTrue(path.startswith(temporary + "/"))

    def test_symlink_loop_is_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, "loop").symlink_to("/loop")
            with self.assertRaises(OSError):
                collector.host_path(temporary, "/loop")

    def test_mount_escaping_and_local_filesystem_selection(self):
        text = "\n".join([
            "20 1 8:2 / / rw - ext4 /dev/sda2 rw",
            "21 1 8:2 / /longer rw - ext4 /dev/sda2 rw",
            "22 1 8:3 / /with\\040space rw - xfs /dev/sdb1 rw",
            "23 1 0:8 / /network rw - nfs server:/share rw",
            "24 1 0:9 / /auto rw - autofs systemd rw",
        ])
        entries = collector.filesystem_entries(text, "/nonexistent-fixture-root")
        self.assertEqual([entry["mount"] for entry in entries], ["/", "/with space"])
        self.assertEqual(collector.unescape_mount(r"/a\040b\134c"), "/a b\\c")

    def test_censorship_handles_fused_options_and_positional_delimiter(self):
        argv = ["curl", "--host=secret", "--port", "8080", "-psecret", "-v", "--", "--secret"]
        shown = collector.censor_argv(argv)
        self.assertEqual(shown[:4], ["curl", "--host=••••••", "--port", "••••"])
        self.assertEqual(shown[4:6], ["-p••••••", "-v"])
        self.assertNotIn("secret", " ".join(shown))
        self.assertTrue(shown[-1].startswith("•"))

    def fixture_proc(self, root):
        folder = Path(root, "222")
        folder.mkdir()
        (folder / "stat").write_text(process_stat(), encoding="utf8")
        (folder / "status").write_text("Uid:\t1000\t1001\t1001\t1001\nVmRSS:\t1024 kB\n", encoding="utf8")
        (folder / "io").write_text("read_bytes: 100\nwrite_bytes: 200\n", encoding="utf8")
        (folder / "cgroup").write_text("0::/system.slice/docker-" + "a" * 64 + ".scope\n", encoding="utf8")
        (folder / "cmdline").write_bytes(b"curl\0--token=secret\0\0")
        return folder

    def test_process_snapshot_reads_effective_uid_and_cgroup(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.fixture_proc(temporary)
            rows = collector.collect_processes("full", 65536, temporary)
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertEqual(row["uid"], 1001)
            self.assertEqual(row["rss"], 1024 * 1024)
            self.assertEqual(row["containerId"], "a" * 64)
            self.assertEqual(row["readBytes"], 100)
            self.assertEqual(row["cmdline"], ["curl", "--token=secret", ""])

    def test_hidden_mode_never_opens_cmdline(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.fixture_proc(temporary)
            opened = []
            original = builtins.open
            def tracked(path, *args, **kwargs):
                opened.append(str(path))
                return original(path, *args, **kwargs)
            with patch("builtins.open", side_effect=tracked):
                rows = collector.collect_processes("hidden", 4096, temporary)
            self.assertEqual(rows[0]["cmdline"], [])
            self.assertFalse(any(path.endswith("/cmdline") for path in opened))

    def test_censored_mode_redacts_before_transport(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.fixture_proc(temporary)
            row = collector.collect_processes("censored", 4096, temporary)[0]
            self.assertNotIn("secret", repr(row))
            self.assertEqual(row["cmdline"][1], "--token=••••••")

    def test_pid_reuse_during_collection_drops_mixed_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.fixture_proc(temporary)
            original, reads = collector.read, 0
            def changed(path, *args):
                nonlocal reads
                if path.endswith("/222/stat"):
                    reads += 1
                    return process_stat(start=123 if reads == 1 else 456)
                return original(path, *args)
            with patch.object(collector, "read", side_effect=changed):
                self.assertEqual(collector.collect_processes("hidden", 4096, temporary), [])

    def test_equal_gpu_values_do_not_merge_different_devices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in (0, 1):
                device = root / f"devices/gpu{index}"
                device.mkdir(parents=True)
                (device / "mem_info_vram_total").write_text("1024")
                card = root / f"class/drm/card{index}"
                card.mkdir(parents=True)
                (card / "device").symlink_to(device)
            alias = root / "class/drm/card2"
            alias.mkdir()
            (alias / "device").symlink_to(root / "devices/gpu0")
            _, _, gpus = collector.collect_hardware(temporary)
            self.assertEqual(len(gpus), 2)

    def test_suspended_gpu_is_visible_without_fake_zero(self):
        with tempfile.TemporaryDirectory() as temporary:
            device = Path(temporary, "class/drm/card0/device")
            (device / "power").mkdir(parents=True)
            (device / "power/runtime_status").write_text("suspended")
            (device / "gpu_busy_percent").write_text("0")
            _, _, gpus = collector.collect_hardware(temporary)
            self.assertEqual(gpus[0]["state"], "suspended")
            self.assertNotIn("busy", gpus[0])

    def test_watchdog_uses_monotonic_atomic_lease_and_expires(self):
        with tempfile.TemporaryDirectory() as temporary:
            class InstantWait:
                def wait(self, _): return False
                def set(self): pass
            with patch.object(collector, "HEARTBEAT", str(Path(temporary, "heartbeat"))), \
                    patch.object(collector, "PID_FILE", str(Path(temporary, "pid"))), \
                    patch.object(collector.time, "monotonic", side_effect=[0, 11]), \
                    patch.object(collector.threading, "Event", return_value=InstantWait()), \
                    patch.object(collector.signal, "signal"):
                collector.watchdog(10)
                self.assertEqual(Path(temporary, "heartbeat").read_text(), "0")
                self.assertEqual(int(Path(temporary, "pid").read_text()), os.getpid())

    def test_signal_rejects_invalid_and_protected_ids_before_pidfd(self):
        with patch.object(collector.os, "pidfd_open", create=True) as opened:
            for request in ({"pid": 1, "startTicks": 10, "signal": "KILL"},
                            {"pid": True, "startTicks": 10, "signal": "TERM"},
                            {"pid": 222, "startTicks": -1, "signal": "TERM"},
                            {"pid": 222, "startTicks": 10, "signal": "BAD"}):
                self.assertFalse(collector.signal_process(request)["ok"])
            opened.assert_not_called()

    @unittest.skipUnless(sys.platform == "linux", "Linux procfs and pidfds required")
    def test_real_snapshot_uses_platform_clock_and_page_information(self):
        original = os.sysconf
        with patch.object(collector.os, "sysconf", side_effect=lambda name: 512 if name == "SC_CLK_TCK" else original(name)):
            snapshot = collector.sample("hidden")
        self.assertEqual(snapshot["clockTicks"], 512)
        self.assertGreater(snapshot["uptime"], 0)
        self.assertGreater(snapshot["memory"]["total"], 0)
        self.assertGreater(len(snapshot["cpus"]), 0)
        self.assertTrue(all(process["cmdline"] == [] for process in snapshot["processes"]))

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"), "Linux pidfds required")
    def test_pidfd_refuses_stale_identity_then_signals_only_disposable_child(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        try:
            start = collector.parse_process_stat(collector.read(f"/proc/{child.pid}/stat", True), 4096)["startTicks"]
            response = collector.signal_process({"pid": child.pid, "startTicks": start + 1, "signal": "TERM"})
            self.assertEqual(response["error"], "STALE_PROCESS")
            self.assertIsNone(child.poll())
            original = collector.read
            def separated_cgroup(path, *args):
                # Only this disposable child is allowed. Production same-cgroup protection stays intact.
                return "test-caller" if path == "/proc/self/cgroup" else original(path, *args)
            with patch.object(collector, "read", side_effect=separated_cgroup):
                response = collector.signal_process({"pid": child.pid, "startTicks": start, "signal": "TERM"})
            self.assertTrue(response["ok"], response)
            child.wait(timeout=5)
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
