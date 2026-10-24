import subprocess
import unittest

from loguru import logger

from app.services import ffmpeg_failure as ff


def _called_process_error(stderr):
    # Production-shaped command: str(CalledProcessError) echoes the full
    # command line, absolute src/out paths included.
    return subprocess.CalledProcessError(
        1, ["ffmpeg", "-i", "/cache/clip.mp4", "/cache/out.mp4"], stderr=stderr
    )


class TestFfmpegStderrTail(unittest.TestCase):
    def test_decodes_bytes_and_keeps_only_the_last_lines(self):
        lines = ["ffmpeg version 7.0.2 banner"] + [f"line {n}" for n in range(30)]
        tail = ff.ffmpeg_stderr_tail(_called_process_error("\n".join(lines).encode()))
        kept = tail.splitlines()
        self.assertEqual(len(kept), ff.FFMPEG_STDERR_TAIL_LINES)
        self.assertEqual(kept[-1], "line 29")
        self.assertEqual(kept[0], "line 20")
        self.assertNotIn("banner", tail)

    def test_invalid_utf8_is_replaced_not_raised(self):
        tail = ff.ffmpeg_stderr_tail(_called_process_error(b"bad \xff byte"))
        self.assertEqual(tail, "bad � byte")

    def test_reads_text_stderr_from_timeout(self):
        exc = subprocess.TimeoutExpired(["ffmpeg"], 600, stderr="frame=  10 stuck")
        self.assertEqual(ff.ffmpeg_stderr_tail(exc), "frame=  10 stuck")

    def test_returns_empty_without_stderr(self):
        self.assertEqual(ff.ffmpeg_stderr_tail(OSError("no such binary")), "")
        self.assertEqual(ff.ffmpeg_stderr_tail(_called_process_error(None)), "")
        self.assertEqual(ff.ffmpeg_stderr_tail(_called_process_error(b"  \n ")), "")

    def test_redacts_secrets(self):
        stderr = b"Server returned 401: Authorization: Bearer abcdef0123456789"
        tail = ff.ffmpeg_stderr_tail(_called_process_error(stderr))
        self.assertNotIn("abcdef0123456789", tail)
        self.assertIn("[redacted]", tail)

    def test_caps_characters(self):
        tail = ff.ffmpeg_stderr_tail(_called_process_error(b"x" * 5000))
        self.assertEqual(len(tail), ff.FFMPEG_STDERR_TAIL_CHARS)


class TestRaiseReencodeFailure(unittest.TestCase):
    def setUp(self):
        self.records = []
        handler_id = logger.add(lambda message: self.records.append(message.record))
        self.addCleanup(logger.remove, handler_id)

    def test_logs_once_at_error_and_raises_with_stderr(self):
        exc = _called_process_error(b"banner\nin.mp4: Invalid data found when processing input")
        with self.assertRaises(ff.FfmpegReencodeError) as ctx:
            ff.raise_reencode_failure("/cache/clip.mp4", exc)

        self.assertIs(ctx.exception.__cause__, exc)
        self.assertIn("ffmpeg re-encode failed for clip.mp4", str(ctx.exception))
        self.assertNotIn("/cache/", str(ctx.exception))
        self.assertIn("returned non-zero exit status 1", str(ctx.exception))
        self.assertIn("Invalid data found", str(ctx.exception))
        errors = [r for r in self.records if r["level"].name == "ERROR"]
        self.assertEqual(len(errors), 1)
        self.assertIn("re-encode failed for clip.mp4", errors[0]["message"])
        self.assertIn("ffmpeg stderr: banner", errors[0]["message"])
        self.assertIn("Invalid data found", errors[0]["message"])
        # The command line inside str(exc) carries absolute paths; both the
        # log line and the raised message must carry the scrubbed form only.
        self.assertNotIn("/cache/", errors[0]["message"])
        self.assertIn("<path>/clip.mp4", str(ctx.exception))
        self.assertIn("<path>/clip.mp4", errors[0]["message"])

    def test_omits_stderr_label_when_there_is_no_stderr(self):
        with self.assertRaises(ff.FfmpegReencodeError) as ctx:
            ff.raise_reencode_failure("/cache/clip.mp4", OSError("no such binary"))
        self.assertEqual(str(ctx.exception), "ffmpeg re-encode failed for clip.mp4: no such binary")
        self.assertEqual(
            self.records[-1]["message"], "[ffmpeg] re-encode failed for clip.mp4: no such binary"
        )

    def test_combined_detail_is_length_capped(self):
        # detail = scrubbed str(exc) (<= 500 chars) + "; ffmpeg stderr: " +
        # the scrubbed tail (<= 500 chars): without a cap on the
        # combination, the log line and the raised message could carry ~
        # 1 KB. The combined detail is capped at 500 chars, keeping the
        # front (the cause and the label), so the whole message stays
        # under the prefix (~39 chars) plus the cap.
        with self.assertRaises(ff.FfmpegReencodeError) as ctx:
            ff.raise_reencode_failure("/cache/clip.mp4", _called_process_error(b"x" * 3000))
        message = str(ctx.exception)
        self.assertLessEqual(len(message), 550)
        self.assertEqual(message.count("ffmpeg stderr:"), 1)
        # The front survives the cut: str(exc)'s scrubbed cause text.
        self.assertIn("returned non-zero exit status 1", message)

    def test_dangling_stderr_label_never_stays_when_tail_has_no_room(self):
        # A scrubbed str(exc) alone can fill the bound (long echoed command
        # line): trimming the tail to nothing must also drop the label —
        # no bare "ffmpeg stderr: " promising a cause that is not there.
        long_command = ["ffmpeg"] + [f"/cache/very/long/path/piece{i:03d}" for i in range(60)]
        exc = subprocess.CalledProcessError(1, long_command, stderr=b"x")
        with self.assertRaises(ff.FfmpegReencodeError) as ctx:
            ff.raise_reencode_failure("/cache/clip.mp4", exc)
        message = str(ctx.exception)
        self.assertNotIn("ffmpeg stderr:", message)
        self.assertLessEqual(len(message), 550)
        self.assertIn("non-zero exit status 1", message)

    def test_error_is_a_runtime_error(self):
        self.assertTrue(issubclass(ff.FfmpegReencodeError, RuntimeError))


if __name__ == "__main__":
    unittest.main()
