import ast
import json
import sys

payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
try:
    same = ast.dump(ast.parse(payload["before"])) == ast.dump(ast.parse(payload["after"]))
except SyntaxError:
    same = False
json.dump(same, sys.stdout)
