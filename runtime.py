"""Install and run an independent local instance without modifying the examples."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess, sys, sysconfig, webbrowser

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / '.venv/Scripts/python.exe'

def run(args):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT)

def prepare_site():
    site = ROOT / 'site'
    if not site.exists():
        shutil.copytree(ROOT / 'examples/site', site)
    # Never merge example files into an existing user's directory.
    return site

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'start', 'stop'])
    args = parser.parse_args()
    if (sys.platform != 'win32' or sys.version_info[:2] != (3, 13)
            or struct.calcsize('P') != 8 or sysconfig.get_config_var('Py_GIL_DISABLED')):
        raise RuntimeError('Requires standard CPython 3.13 x64 on Windows.')
    if args.action == 'install':
        lock = json.loads((ROOT / 'dependencies.lock.json').read_text(encoding='utf-8'))
        for wheel in lock['wheels']:
            path = ROOT / 'wheels' / wheel['filename']
            if not path.is_file():
                raise RuntimeError('Offline wheels missing. For a source checkout, first run: python tools/fetch_wheels.py')
            if hashlib.sha256(path.read_bytes()).hexdigest() != wheel['sha256']:
                raise RuntimeError('Offline wheel checksum mismatch: ' + wheel['filename'])
        run([sys.executable, '-m', 'venv', ROOT / '.venv'])
        run([PYTHON, '-m', 'pip', '--disable-pip-version-check', 'install', '--no-index',
             '--require-hashes', '--find-links', ROOT / 'wheels', '-r', ROOT / 'program/requirements.lock.txt'])
        run([PYTHON, '-m', 'pip', 'check'])
        run([PYTHON, ROOT / 'tools/build_snapshot.py'])
        prepare_site()
        print('Offline installation complete. Run the start script.')
        return
    if not PYTHON.exists():
        raise RuntimeError('Run the first-install script before starting.')
    port = int(os.environ.get('WORKBENCH_PORT', '8767'))
    if not 1024 <= port <= 65535:
        raise ValueError('WORKBENCH_PORT must be between 1024 and 65535.')
    site = prepare_site()
    command = [PYTHON, ROOT / 'program/launcher.py', '--root', site, '--port', str(port)]
    if args.action == 'stop':
        command.append('--stop')
    run(command)
    if args.action == 'start' and not os.environ.get('WORKBENCH_NO_BROWSER'):
        webbrowser.open(f'http://127.0.0.1:{port}/app/')

if __name__ == '__main__':
    main()
