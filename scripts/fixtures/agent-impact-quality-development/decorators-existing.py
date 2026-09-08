from flask import Flask, Blueprint
from typing_extensions import assert_type
app = Flask(__name__)
bp = Blueprint("bp", __name__)

@app.template_filter()
def app_filter_0(value: str) -> str:
    return value
assert_type(app_filter_0("value"), str)

@app.template_filter("named")
def app_filter_1(value: str) -> str:
    return value
assert_type(app_filter_1("value"), str)

@app.template_filter(name="named")
def app_filter_2(value: str) -> str:
    return value
assert_type(app_filter_2("value"), str)

@app.template_test()
def app_test_0(value: str) -> bool:
    return True
assert_type(app_test_0("value"), bool)

@app.template_test("named")
def app_test_1(value: str) -> bool:
    return True
assert_type(app_test_1("value"), bool)

@app.template_test(name="named")
def app_test_2(value: str) -> bool:
    return True
assert_type(app_test_2("value"), bool)

@app.template_global()
def app_global_0(value: str) -> str:
    return value
assert_type(app_global_0("value"), str)

@app.template_global("named")
def app_global_1(value: str) -> str:
    return value
assert_type(app_global_1("value"), str)

@app.template_global(name="named")
def app_global_2(value: str) -> str:
    return value
assert_type(app_global_2("value"), str)

@bp.app_template_filter()
def bp_filter_0(value: str) -> str:
    return value
assert_type(bp_filter_0("value"), str)

@bp.app_template_filter("named")
def bp_filter_1(value: str) -> str:
    return value
assert_type(bp_filter_1("value"), str)

@bp.app_template_filter(name="named")
def bp_filter_2(value: str) -> str:
    return value
assert_type(bp_filter_2("value"), str)

@bp.app_template_test()
def bp_test_0(value: str) -> bool:
    return True
assert_type(bp_test_0("value"), bool)

@bp.app_template_test("named")
def bp_test_1(value: str) -> bool:
    return True
assert_type(bp_test_1("value"), bool)

@bp.app_template_test(name="named")
def bp_test_2(value: str) -> bool:
    return True
assert_type(bp_test_2("value"), bool)

@bp.app_template_global()
def bp_global_0(value: str) -> str:
    return value
assert_type(bp_global_0("value"), str)

@bp.app_template_global("named")
def bp_global_1(value: str) -> str:
    return value
assert_type(bp_global_1("value"), str)

@bp.app_template_global(name="named")
def bp_global_2(value: str) -> str:
    return value
assert_type(bp_global_2("value"), str)
