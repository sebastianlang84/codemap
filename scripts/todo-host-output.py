"""Observe local host serialization using dummy SSE responses in a network namespace."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

MARKER = 'CODEMAP_HOST_DUMMY_FULL_SOURCE_A72_END'
SOURCE = 'export function probeSource() {\n' + ''.join(f'  // dummy fixture line {i:02d}\n' for i in range(45)) + f'  return "{MARKER}";\n' + '}\n'
ROOT = Path('/work')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def clean_env():
    return {'PATH': '/usr/bin:/bin', 'HOME': '/work/home', 'CODEX_HOME': '/work/codex',
            'PI_CODING_AGENT_DIR': '/work/pi', 'CODEMAP_HOME': '/work/state',
            'CODEMAP_TELEMETRY': '0', 'PI_OFFLINE': '1', 'DUMMY_API_KEY': 'dummy-local-only',
            'TERM': 'dumb', 'NO_COLOR': '1'}


def inner(selected_host):
    for name in ('repo', 'home', 'codex', 'pi', 'artifacts'):
        (ROOT / name).mkdir(exist_ok=True)
    repo = ROOT / 'repo'
    (repo / 'probe.ts').write_text(SOURCE)
    env = clean_env()
    def run(command):
        return subprocess.run(command, cwd=repo, env=env, capture_output=True, timeout=90)
    for command in (['git', 'init', '-q'], ['git', 'add', 'probe.ts'],
                    ['git', '-c', 'user.name=Dummy Probe', '-c', 'user.email=dummy@example.invalid', 'commit', '-qm', 'fixture']):
        result = run(command)
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
    result = run(['node', '--experimental-strip-types', '--input-type=module', '-e',
                  'import {indexRepo} from "/code/src/core/indexer.ts"; indexRepo({cwd:"/work/repo",stateDir:"/work/state",approve:true})'])
    if result.returncode:
        raise RuntimeError(result.stderr.decode())
    requests = {'pi': [], 'codex': []}
    class Stub(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            self.send_response(404)
            self.end_headers()
        def do_POST(self):
            data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            host = 'pi' if 'chat/completions' in self.path else 'codex'
            body = json.loads(data)
            requests[host].append(body)
            (ROOT / 'artifacts' / f'{host}-request-{len(requests[host])}.json').write_bytes(data)
            first = not tool_outputs(body, host)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            def event(value, name=None):
                prefix = f'event: {name}\n' if name else ''
                self.wfile.write((prefix + 'data: ' + json.dumps(value) + '\n\n').encode())
                self.wfile.flush()
            if host == 'pi':
                tool_name = next(t['function']['name'] for t in body['tools'] if t['function']['name'] == 'codemap_context')
                def chunk(delta, finish=None):
                    return {'id': 'chatcmpl_probe', 'object': 'chat.completion.chunk', 'created': 1,
                            'model': 'probe', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                if first:
                    event(chunk({'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_probe', 'type': 'function',
                                'function': {'name': tool_name, 'arguments': json.dumps({'target': 'probe.ts'})}}]}))
                    event(chunk({}, 'tool_calls'))
                else:
                    event(chunk({'role': 'assistant', 'content': 'Probe complete.'}))
                    event(chunk({}, 'stop'))
                self.wfile.write(b'data: [DONE]\n\n')
            else:
                offered = []
                advertised = list(body.get('tools', []))
                for item in body.get('input', []):
                    if item.get('type') == 'additional_tools':
                        advertised.extend(item.get('tools', []))
                for tool in advertised:
                    if tool.get('type') == 'namespace':
                        offered.extend({**nested, 'namespace': tool['name']} for nested in tool.get('tools', []))
                    else:
                        offered.append(tool)
                direct = next((t for t in offered if t.get('name', '').endswith('codemap_context')), None)
                execute = next((t for t in offered if t.get('name') == 'exec'), None)
                selected = direct or execute
                if selected is None:
                    raise RuntimeError('No direct codemap_context or exec tool offered')
                code = 'text(await tools.mcp__codemap__codemap_context({target:"probe.ts"}));'
                call = {'id': 'fc_probe', 'call_id': 'call_probe', 'name': selected['name'], 'status': 'completed'}
                if selected.get('namespace'):
                    call['namespace'] = selected['namespace']
                call.update({'type': 'custom_tool_call', 'input': code} if not direct else
                            {'type': 'function_call', 'arguments': json.dumps({'target': 'probe.ts'})})
                item = call if first else {
                        'id': 'msg_probe', 'type': 'message', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'output_text', 'text': 'Probe complete.', 'annotations': []}]}
                response = {'id': 'resp_probe_' + str(len(requests[host])), 'object': 'response',
                            'created_at': 1, 'model': 'gpt-5.6-luna', 'status': 'in_progress', 'output': []}
                event({'type': 'response.created', 'response': response}, 'response.created')
                event({'type': 'response.output_item.added', 'output_index': 0, 'item': item}, 'response.output_item.added')
                event({'type': 'response.output_item.done', 'output_index': 0, 'item': item}, 'response.output_item.done')
                response = {**response, 'status': 'completed', 'output': [item],
                            'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}
                event({'type': 'response.completed', 'response': response}, 'response.completed')
            self.close_connection = True
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f'http://127.0.0.1:{server.server_port}/v1'
    (ROOT / 'pi/models.json').write_text(json.dumps({'providers': {'probe': {'baseUrl': base_url,
        'api': 'openai-completions', 'apiKey': 'dummy-local-only', 'models': [{'id': 'probe', 'name': 'Offline probe',
        'reasoning': False, 'input': ['text'], 'contextWindow': 32000, 'maxTokens': 1024}]}}}))
    (ROOT / 'codex/config.toml').write_text(f'''model = "gpt-5.6-luna"
model_provider = "probe"
model_reasoning_effort = "medium"
[model_providers.probe]
name = "Local dummy probe"
base_url = "{base_url}"
wire_api = "responses"
env_key = "DUMMY_API_KEY"
requires_openai_auth = false
[mcp_servers.codemap]
command = "/usr/bin/node"
args = ["--experimental-strip-types", "/code/src/mcp/bin.ts"]
cwd = "/work/repo"
[mcp_servers.codemap.env]
CODEMAP_HOME = "/work/state"
CODEMAP_TELEMETRY = "0"
''')
    commands = {
        'pi': ['node', '/code/node_modules/@earendil-works/pi-coding-agent/dist/cli.js', '--provider', 'probe',
               '--model', 'probe', '--thinking', 'medium', '--offline', '--no-session', '--no-extensions',
               '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-builtin-tools',
               '-e', '/code/src/pi-extension/index.ts', '--mode', 'json', '-p', 'Call codemap_context for probe.ts once.'],
        'codex': ['/codex', 'exec', '--ephemeral', '--json', '--dangerously-bypass-approvals-and-sandbox',
                  'Call codemap_context for probe.ts once.']}
    report = {'sourceSha256': sha(SOURCE.encode()), 'sourceBytes': len(SOURCE.encode()), 'marker': MARKER,
              'networkBoundary': 'bwrap --unshare-all; only namespace loopback; no host credentials mounted', 'hosts': {}}
    for host, command in commands.items():
        if selected_host != 'both' and selected_host != host:
            continue
        try:
            completed = run(command)
            exit_code, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
        except subprocess.TimeoutExpired as error:
            exit_code, stdout, stderr = 124, error.stdout or b'', error.stderr or b''
        (ROOT / 'artifacts' / f'{host}-stdout.log').write_bytes(stdout)
        (ROOT / 'artifacts' / f'{host}-stderr.log').write_bytes(stderr)
        payload = requests[host][1] if len(requests[host]) > 1 else None
        report['hosts'][host] = {'exitCode': exit_code, 'requests': len(requests[host]),
            **analyze_payload(payload, host),
            'followupSha256': sha((ROOT / 'artifacts' / f'{host}-request-2.json').read_bytes()) if payload else None,
            'stdoutSha256': sha(stdout), 'stderrSha256': sha(stderr)}
    report['hostVersions'] = {'codex': run(['/codex', '--version']).stdout.decode().strip(),
        'pi': json.loads(Path('/code/node_modules/@earendil-works/pi-coding-agent/package.json').read_text())['version'],
        'node': run(['node', '--version']).stdout.decode().strip()}
    report['runnerSha256'] = sha(Path(__file__).read_bytes())
    server.shutdown()
    (ROOT / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


def recursive_strings(value):
    found = []
    if isinstance(value, str):
        found.append(value.rstrip('\n'))
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return found
        found.extend(recursive_strings(parsed))
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(recursive_strings(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(recursive_strings(item))
    return found


def tool_outputs(payload, host):
    if not isinstance(payload, dict):
        return []
    rows = payload.get('messages', []) if host == 'pi' else payload.get('input', [])
    return [item for item in rows if item.get('role') == 'tool' or
            item.get('type') in ('custom_tool_call_output', 'function_call_output')]


def analyze_payload(payload, host):
    outputs = tool_outputs(payload, host)
    strings = recursive_strings(outputs)
    return {'toolOutputCount': len(outputs), 'markerInFollowup': any(MARKER in s for s in strings),
            'sourceInFollowup': SOURCE.rstrip('\n') in strings,
            'hasStructuredContent': any('"structuredContent"' in s for s in strings)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inner', action='store_true')
    parser.add_argument('--host', choices=['both', 'pi', 'codex'], default='both')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if args.inner:
        inner(args.host)
        return
    if not args.output_dir:
        parser.error('--output-dir is required')
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    base = Path(__file__).resolve().parent.parent
    codex = Path(shutil.which('codex')).resolve()
    modules = (base / 'node_modules').resolve()
    command = ['bwrap', '--unshare-all', '--die-with-parent', '--new-session']
    for path in ('/usr', '/bin', '/lib', '/lib64'):
        command += ['--ro-bind', path, path]
    command += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', str(output), '/work',
                '--ro-bind', str(codex), '/codex', '--ro-bind', str(codex.with_name('codex-code-mode-host')), '/codex-code-mode-host',
                '--ro-bind', str(Path(__file__).resolve()), '/probe.py',
                '--ro-bind', str(modules), '/code/node_modules']
    for name in ('src', 'migrations', 'package.json'):
        command += ['--ro-bind', str(base / name), '/code/' + name]
    command += ['--chdir', '/work', '/usr/bin/python3', '/probe.py', '--inner', '--host', args.host]
    completed = subprocess.run(command, env={'PATH': '/usr/bin:/bin'}, timeout=210)
    raise SystemExit(completed.returncode)


if __name__ == '__main__':
    main()
