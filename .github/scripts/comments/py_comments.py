import io
import json
import sys
import tokenize


def utf16_len(text):
    return len(text.encode("utf-16-le")) // 2


source = sys.stdin.buffer.read().decode("utf-8")
lines = io.StringIO(source).readlines()
line_starts = [0]
for line in lines:
    line_starts.append(line_starts[-1] + utf16_len(line))


def offset(row, col):
    line = lines[row - 1] if row - 1 < len(lines) else ""
    return line_starts[row - 1] + utf16_len(line[:col])


comments = []
for token in tokenize.generate_tokens(io.StringIO(source).readline):
    if token.type == tokenize.COMMENT:
        comments.append(
            {
                "start": offset(*token.start),
                "end": offset(*token.end),
                "text": token.string,
            }
        )

json.dump(comments, sys.stdout)
