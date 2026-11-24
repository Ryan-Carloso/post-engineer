"""Source-scan tests for the Modal CPU worker app (modal_cpu_worker.py).

The module only runs inside Modal, so nothing else in the suite notices it
drifting from the dispatcher. These tests pin the function names the
dispatcher spawns, the resources each one requests, and which secrets reach
which container.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

from app.services import remote_dispatch
from app.services.cpu_worker_dispatch import FUNCTION_NAME

ENGINE_DIR = Path(__file__).resolve().parents[2]
SOURCE = (ENGINE_DIR / "modal_cpu_worker.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)


def _module_constants() -> dict[str, object]:
    constants: dict[str, object] = {}
    for node in TREE.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                constants[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                continue
    return constants


def _decorated_functions() -> dict[str, dict[str, object]]:
    constants = _module_constants()
    functions: dict[str, dict[str, object]] = {}
    for node in TREE.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for decorator in node.decorator_list:
            if (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr == "function"
            ):
                kwargs: dict[str, object] = {}
                for keyword in decorator.keywords:
                    if isinstance(keyword.value, ast.Name):
                        kwargs[keyword.arg] = constants.get(keyword.value.id, keyword.value.id)
                    else:
                        kwargs[keyword.arg] = ast.literal_eval(keyword.value)
                functions[node.name] = kwargs
    return functions


class WorkerFunctionContractTests(unittest.TestCase):
    def test_the_app_defines_exactly_the_functions_the_dispatchers_spawn(self):
        self.assertEqual(
            set(_decorated_functions()),
            set(remote_dispatch.WORKER_FUNCTIONS) | {FUNCTION_NAME},
        )

    def test_the_app_name_matches_the_documented_config_value(self):
        self.assertEqual(_module_constants()["WORKER_APP_NAME"], "post-engineer-cpu-worker")
        config = (ENGINE_DIR / "config.example.toml").read_text(encoding="utf-8")
        self.assertIn('("post-engineer-cpu-worker")', config)

    def test_resources_per_function(self):
        functions = _decorated_functions()
        expected = {
            remote_dispatch.FACELESS_FUNCTION: (1.0, 4096, 30, 1800),
            remote_dispatch.FACELESS_CLONE_FUNCTION: (1.0, 10240, 30, 1800),
            remote_dispatch.LIPSYNC_FUNCTION: (2.0, 10240, 2, 14400),
        }
        for name, (cpu, memory, max_containers, timeout) in expected.items():
            with self.subTest(function=name):
                kwargs = functions[name]
                self.assertEqual(kwargs["cpu"], cpu)
                self.assertEqual(kwargs["memory"], memory)
                self.assertEqual(kwargs["max_containers"], max_containers)
                self.assertEqual(kwargs["timeout"], timeout)
                self.assertEqual(kwargs["min_containers"], 0)
                self.assertNotIn("gpu", kwargs)

    def test_only_the_lipsync_function_gets_the_longcat_client_secret(self):
        functions = _decorated_functions()
        for name, kwargs in functions.items():
            with self.subTest(function=name):
                if name == remote_dispatch.LIPSYNC_FUNCTION:
                    expected = "LIPSYNC_SECRETS"
                elif name == FUNCTION_NAME:
                    expected = "CPU_WORKER_SECRETS"
                else:
                    expected = "WORKER_SECRETS"
                self.assertEqual(kwargs["secrets"], expected)
        self.assertIn('modal.Secret.from_name("post-engineer-longcat-client")', SOURCE)

    def test_every_function_runs_the_shared_entrypoint(self):
        for node in TREE.body:
            if isinstance(node, ast.FunctionDef) and node.name in remote_dispatch.WORKER_FUNCTIONS:
                with self.subTest(function=node.name):
                    calls = [
                        child.func.id
                        for child in ast.walk(node)
                        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
                    ]
                    self.assertEqual(calls, ["_render"])
        self.assertIn("from app.services.remote_worker import run", SOURCE)

    def test_the_image_points_the_worker_at_its_tts_virtualenv(self):
        self.assertIn('"TTS_PYTHON": f"{TTS_VENV}/bin/python"', SOURCE)
        self.assertIn('"MPT_STATE_BACKEND": "supabase"', SOURCE)


if __name__ == "__main__":
    unittest.main()
