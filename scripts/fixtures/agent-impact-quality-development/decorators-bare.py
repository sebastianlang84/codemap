from flask import Flask, Blueprint
from typing_extensions import assert_type
app = Flask(__name__)
bp = Blueprint("bp", __name__)

@app.template_filter
def app_filter_0(value: str) -> str:
    return value
assert_type(app_filter_0("value"), str)

@app.template_test
def app_test_0(value: str) -> bool:
    return True
assert_type(app_test_0("value"), bool)

@app.template_global
def app_global_0(value: str) -> str:
    return value
assert_type(app_global_0("value"), str)

@bp.app_template_filter
def bp_filter_0(value: str) -> str:
    return value
assert_type(bp_filter_0("value"), str)

@bp.app_template_test
def bp_test_0(value: str) -> bool:
    return True
assert_type(bp_test_0("value"), bool)

@bp.app_template_global
def bp_global_0(value: str) -> str:
    return value
assert_type(bp_global_0("value"), str)
