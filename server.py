#!/usr/bin/env python3
"""ANODE SURVIVAL — игровой сервер (только стандартная библиотека Python 3.8+).
Запуск:  python server.py [порт] [--name ИМЯ] [--max N] [--noreg] [--proxy] [--fresh]
Подробная инструкция — в файле server.txt. Команды администратора — вводятся в консоль, help — список."""
import random, hmac, secrets, re, math, http.server, socketserver, socket, sys, os, json, threading, time, struct, hashlib, base64, mimetypes, functools, sqlite3, shutil

HERE = os.path.dirname(os.path.abspath(__file__)); VER = 40
LOGF = os.path.join(os.environ.get('DATA_DIR') or HERE, 'server.log'); _pl = threading.Lock()
def print(*a):
    msg = ' '.join(str(x) for x in a); sys.stdout.write(msg + '\n'); sys.stdout.flush()
    try:
        with _pl:
            if os.path.exists(LOGF) and os.path.getsize(LOGF) > 2_000_000: os.replace(LOGF, LOGF + '.old')
            with open(LOGF, 'a', encoding='utf-8') as f: f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except OSError: pass
argv = sys.argv[1:]
if '--help' in argv or '-h' in argv: sys.exit(__doc__)
CFGF = os.path.join(HERE, 'server.json')          # необязательные настройки; аргументы командной строки главнее
try:
    with open(CFGF, encoding='utf-8') as f: CFG = json.load(f)
except (OSError, ValueError):
    CFG = {'name': 'ANODE server', 'port': 8000, 'max': 16, 'noreg': False, 'proxy': False}
    try:
        with open(CFGF, 'w', encoding='utf-8') as f: json.dump(CFG, f, ensure_ascii=False, indent=2)
    except OSError: pass
def opt(n, d):
    return argv[argv.index(n) + 1] if n in argv and argv.index(n) + 1 < len(argv) else d
PORT = int(argv[0]) if argv and argv[0].isdigit() else int(os.environ.get('PORT') or CFG.get('port', 8000))   # Render/Heroku кладут порт в PORT
NAME = str(opt('--name', CFG.get('name', 'ANODE')))[:32]
MAXP = max(1, int(opt('--max', CFG.get('max', 16))))

def is_root(d): return os.path.isfile(os.path.join(d, 'index.html')) and os.path.isfile(os.path.join(d, 'js', 'game.js'))
def find_root():
    for base in (HERE, os.getcwd()):
        if is_root(base): return base
        try:
            for a in sorted(os.listdir(base)):
                p = os.path.join(base, a)
                if os.path.isdir(p) and is_root(p): return p
        except OSError: pass
ROOT = find_root() or sys.exit('Не нашёл папку игры (index.html + js/game.js).')
mimetypes.add_type('image/webp', '.webp'); mimetypes.add_type('application/javascript', '.js')

# ---------------- база данных (SQLite, файл anode.db рядом со скриптом) ----------------
DATA = os.environ.get('DATA_DIR') or HERE      # на Render сюда монтируется постоянный диск
DBF = os.path.join(DATA, 'anode.db')
if '--fresh' in argv:
    for e in ('', '-wal', '-shm'):
        try: os.remove(DBF + e)
        except OSError: pass
elif os.path.exists(DBF):
    try: shutil.copy(DBF, DBF + '.bak')
    except OSError: pass

# ---------------- PostgreSQL (если задан DATABASE_URL) или SQLite ----------------
DATABASE_URL = os.environ.get('DATABASE_URL') or str(CFG.get('database_url') or '').strip().strip('"\'')
if DATABASE_URL and 'sslmode' not in DATABASE_URL and '.render.com' in DATABASE_URL: DATABASE_URL += ('&' if '?' in DATABASE_URL else '?') + 'sslmode=require'   # External URL требует SSL
PG = bool(DATABASE_URL) and '--sqlite' not in argv
if os.environ.get('RENDER') and not PG and not os.path.ismount(DATA) and '--fresh' not in argv:
    sys.exit('!!! На Render нет DATABASE_URL и нет постоянного диска: аккаунты и мир пропадут при каждом перезапуске.\n'
             'Добавь в Environment сервиса переменную DATABASE_URL (Internal Database URL из Render → PostgreSQL → Connect) и сделай Manual Deploy.')
if PG:
    try: import psycopg2
    except ImportError:
        print('* ставлю psycopg2-binary…')
        try:
            import subprocess, site, importlib
            _in_venv = sys.prefix != getattr(sys, 'base_prefix', sys.prefix)
            for _extra in ([[]] if _in_venv else [['--user', '--break-system-packages'], ['--break-system-packages'], []]):   # в venv (Render) --user запрещён
                try: subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q'] + _extra + ['psycopg2-binary>=2.9.11']); break
                except Exception: continue
            importlib.invalidate_caches()
            try: sys.path.append(site.getusersitepackages())
            except Exception: pass
            import psycopg2
        except Exception as e:
            sys.exit('!!! DATABASE_URL задан, но psycopg2 не установился (%s). Добавь в Build Command: pip install -r requirements.txt' % e)
PG_COLS = {'dead': ('i', 't'), 'res_hp': ('i', 'h'), 'bhp': ('id', 'h'), 'locks': ('k', 'c'), 'storage': ('id', 'j'), 'bans': ('kind', 'v', 'reason', 't'), 'meta': ('k', 'v')}
PG_PK = {'dead': ('i',), 'res_hp': ('i',), 'bhp': ('id',), 'locks': ('k',), 'storage': ('id',), 'bans': ('kind', 'v'), 'meta': ('k',), 'dauth': ('u', 'k')}
PG_SERIAL = ('builds', 'chatlog', 'bags')
class PGCur:
    def __init__(self, cur, rid=None): self.cur, self.lastrowid = cur, rid
    def fetchall(self): return [tuple(bytes(v) if isinstance(v, memoryview) else v for v in r) for r in self.cur.fetchall()] if self.cur.description else []
    def fetchone(self): r = self.fetchall(); return r[0] if r else None
class PGDB:
    def __init__(self, url): self.url, self.c = url, None; self._conn()
    def _conn(self):
        self.c = psycopg2.connect(self.url, connect_timeout=10); self.c.autocommit = True
    @staticmethod
    def tr(sql):
        s = sql.strip().rstrip(';')
        m = re.match(r'INSERT OR (REPLACE|IGNORE) INTO (\w+) VALUES\((.*)\)$', s, re.S)
        if m:
            kind, t, v = m.groups(); pk = PG_PK[t]; cols = PG_COLS.get(t)
            s = f'INSERT INTO {t} VALUES({v})'
            if kind == 'IGNORE' or not cols or all(c in pk for c in cols): s += ' ON CONFLICT DO NOTHING'
            else: s += f' ON CONFLICT ({",".join(pk)}) DO UPDATE SET ' + ','.join(f'{c}=EXCLUDED.{c}' for c in cols if c not in pk)
        s = s.replace('%', '%%').replace('?', '%s')
        mt = re.match(r'INSERT INTO (\w+)', s)
        if mt and mt.group(1) in PG_SERIAL and 'RETURNING' not in s and 'ON CONFLICT' not in s: return s + ' RETURNING id', True
        return s, False
    def execute(self, sql, a=()):
        s, ret = self.tr(sql)
        for att in (0, 1):
            try:
                cur = self.c.cursor(); cur.execute(s, tuple(a)); rid = cur.fetchone()[0] if ret else None
                return PGCur(cur, rid)
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                if att: raise
                try: self.c.close()
                except Exception: pass
                self._conn()
    def executemany(self, sql, rows):
        for r in rows: self.execute(sql, r)
    def executescript(self, script):
        for st in script.split(';'):
            st = st.strip()
            if not st or st.upper().startswith('PRAGMA'): continue
            st = re.sub(r'INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY', st); st = re.sub(r'\bREAL\b', 'DOUBLE PRECISION', st)
            st = re.sub(r'\bBLOB\b', 'BYTEA', st).replace(' COLLATE NOCASE', '')
            self.execute(st)
    def commit(self): pass
    def close(self):
        try: self.c.close()
        except Exception: pass
DBL = threading.Lock()
if PG:
    if '--fresh' in argv:
        _t = PGDB(DATABASE_URL)
        for t_ in ('dead', 'res_hp', 'builds', 'players', 'accounts', 'sessions', 'bans', 'chatlog', 'meta', 'bags', 'bhp', 'locks', 'dauth', 'storage'): _t.execute(f'DROP TABLE IF EXISTS {t_}')
        _t.close()
    try: DB = PGDB(DATABASE_URL); print('База: PostgreSQL ->', re.sub(r'//[^@]*@', '//***@', DATABASE_URL).split('?')[0])
    except Exception as e: sys.exit('!!! Не удалось подключиться к PostgreSQL: %s\nПроверь DATABASE_URL (Internal Database URL из Render).' % e)
else:
    DB = sqlite3.connect(DBF, check_same_thread=False)
    print('База: SQLite ->', DBF)
DB.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS dead(i INTEGER PRIMARY KEY, t REAL);
CREATE TABLE IF NOT EXISTS res_hp(i INTEGER PRIMARY KEY, h REAL);
CREATE TABLE IF NOT EXISTS builds(id INTEGER PRIMARY KEY AUTOINCREMENT, j TEXT);
CREATE TABLE IF NOT EXISTS players(tok TEXT PRIMARY KEY, name TEXT, x REAL, y REAL, z REAL, hp REAL, hu REAL, th REAL, st REAL,
  inv TEXT, kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0, playtime INTEGER DEFAULT 0, first REAL, seen REAL);''')
DB.executescript('''CREATE TABLE IF NOT EXISTS accounts(u TEXT PRIMARY KEY COLLATE NOCASE, salt BLOB, h BLOB, created REAL, last_login REAL, last_ip TEXT);
CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY, u TEXT, exp REAL, ip TEXT);''')
DB.executescript('''CREATE TABLE IF NOT EXISTS bans(kind TEXT, v TEXT, reason TEXT, t REAL, PRIMARY KEY(kind,v));
CREATE TABLE IF NOT EXISTS chatlog(id INTEGER PRIMARY KEY AUTOINCREMENT, t REAL, u TEXT, m TEXT);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS bags(id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT, n INTEGER, d REAL, x REAL, y REAL, z REAL, t REAL, owner TEXT);
INSERT OR IGNORE INTO meta VALUES('schema','2');''')

def migrate_sqlite_to_pg():   # разовый перенос существующего мира из anode.db в PostgreSQL
    if not PG or not os.path.exists(DBF) or '--fresh' in argv: return
    if DB.execute("SELECT v FROM meta WHERE k='migrated'").fetchall(): return
    try:
        src = sqlite3.connect(DBF); n = 0
        for t_ in ('dead', 'res_hp', 'builds', 'players', 'accounts', 'sessions', 'bans', 'chatlog', 'meta', 'bags', 'bhp', 'locks', 'dauth', 'storage'):
            try: cols = [r[1] for r in src.execute(f'PRAGMA table_info({t_})')]; rows = src.execute(f'SELECT {",".join(cols)} FROM {t_}').fetchall()
            except sqlite3.Error: continue
            for r in rows:
                if t_ == 'meta' and r[0] == 'schema': continue
                DB.c.cursor().execute(f'INSERT INTO {t_}({",".join(cols)}) VALUES({",".join(["%s"] * len(cols))}) ON CONFLICT DO NOTHING', tuple(r)); n += 1
        for t_ in PG_SERIAL: DB.execute(f"SELECT setval(pg_get_serial_sequence('{t_}','id'), COALESCE((SELECT MAX(id) FROM {t_}),1), (SELECT MAX(id) FROM {t_}) IS NOT NULL)")
        DB.execute("INSERT INTO meta VALUES('migrated','1') ON CONFLICT DO NOTHING".replace('%', '%%')); src.close(); print(f'* перенесено из SQLite в PostgreSQL: {n} записей')
    except Exception as e: print('!!! ошибка переноса SQLite → PostgreSQL:', e)
def q(sql, a=()):
    with DBL:
        c = DB.execute(sql, a); DB.commit(); return c
def qa(sql, a=()):
    with DBL: return DB.execute(sql, a).fetchall()

# ---------------- аккаунты ----------------
NOREG, PROXY = '--noreg' in argv or bool(CFG.get('noreg')), '--proxy' in argv or bool(CFG.get('proxy')) or bool(os.environ.get('RENDER'))      # --noreg: закрыть регистрацию; --proxy: брать IP из X-Forwarded-For
UNAME = re.compile(r'^[A-Za-zА-Яа-яЁё0-9_-]{3,16}$')
AL = threading.Lock(); fails = {}; regs = {}; wsips = {}
def too_many(d, ip, lim, win):
    with AL:
        l = [t for t in d.get(ip, []) if time.time() - t < win]; d[ip] = l; return len(l) >= lim
def note(d, ip):
    with AL: d.setdefault(ip, []).append(time.time())
def pw_hash(pw, salt): return hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 120000)
def sess_key(tok): return hashlib.sha256(tok.encode()).hexdigest()
def new_session(u, ip):
    tok = secrets.token_urlsafe(32)
    q('INSERT INTO sessions VALUES(?,?,?,?)', (sess_key(tok), u, time.time() + 30 * 86400, ip)); return tok
def session_user(tok):
    if not isinstance(tok, str) or not tok: return None
    r = qa('SELECT u,exp FROM sessions WHERE tok=?', (sess_key(tok),))
    return r[0][0] if r and r[0][1] > time.time() else None
q('DELETE FROM sessions WHERE exp<?', (time.time(),))
def find_acc(u):
    f = u.casefold()
    for r in qa('SELECT u,salt,h FROM accounts'):
        if r[0].casefold() == f: return r
def banned(u, ip):
    r = qa("SELECT reason FROM bans WHERE (kind='ip' AND v=?) OR (kind='user' AND v=?)", (ip, (u or '').casefold()))
    return r[0][0] if r else None
def api_auth(kind, d, ip):
    u, p = str(d.get('u', '')).strip(), str(d.get('p', ''))
    b = banned(u, ip)
    if b is not None: return 403, {'error': 'Вы заблокированы' + (': ' + b if b else '')}
    if kind == 'register':
        if NOREG: return 403, {'error': 'Регистрация закрыта администратором'}
        if too_many(regs, ip, 5, 3600): return 429, {'error': 'Слишком много регистраций с вашего IP, подождите'}
        if not UNAME.match(u): return 400, {'error': 'Ник: 3–16 символов (буквы, цифры, _ и -)'}
        if not 6 <= len(p) <= 64: return 400, {'error': 'Пароль: 6–64 символа'}
        if qa('SELECT COUNT(*) FROM accounts')[0][0] >= 1000: return 403, {'error': 'Достигнут лимит аккаунтов'}
        salt = secrets.token_bytes(16)
        if find_acc(u): return 409, {'error': 'Этот ник уже занят'}
        q('INSERT INTO accounts VALUES(?,?,?,?,?,?)', (u, salt, pw_hash(p, salt), time.time(), time.time(), ip))
        note(regs, ip); print(f'* регистрация: {u} ({ip})')
        return 200, {'token': new_session(u, ip), 'u': u}
    if too_many(fails, ip, 8, 600): return 429, {'error': 'Слишком много неверных попыток, подождите 10 минут'}
    a = find_acc(u); r = [a] if a else []
    salt = r[0][1] if r else b'x' * 16
    ok = hmac.compare_digest(pw_hash(p, salt), r[0][2] if r else b'') if r else (pw_hash(p, salt) and False)
    if not ok: note(fails, ip); return 401, {'error': 'Неверный ник или пароль'}
    q('UPDATE accounts SET last_login=?, last_ip=? WHERE u=?', (time.time(), ip, r[0][0])); print(f'* вход: {r[0][0]} ({ip})')
    return 200, {'token': new_session(r[0][0], ip), 'u': r[0][0]}

LOCK = threading.Lock(); clients = {}; _id = [1]
world = {'dead': [r[0] for r in qa('SELECT i FROM dead')], 'hp': {str(i): h for i, h in qa('SELECT i,h FROM res_hp')},
         'builds': [json.loads(r[0]) for r in qa('SELECT j FROM builds ORDER BY id')]}

bags = {r[0]: {'id': r[0], 'k': r[1], 'n': r[2], 'd': r[3], 'x': r[4], 'y': r[5], 'z': r[6], 't': r[7]}
        for r in qa('SELECT id,k,n,d,x,y,z,t FROM bags')}
BAG_TTL, BAG_MAX, ITEMK = 900, 400, re.compile(r'^[\w-]{1,32}$')
def bag_pub(b): return {k: b[k] for k in ('id', 'k', 'n', 'd', 'x', 'y', 'z') if b.get(k) is not None}

# ---------- постройки: здоровье деталей, замки с кодом, ящики, гниение (всё считает сервер) ----------
DB.executescript('''CREATE TABLE IF NOT EXISTS bhp(id TEXT PRIMARY KEY, h REAL);
CREATE TABLE IF NOT EXISTS locks(k TEXT PRIMARY KEY, c TEXT);
CREATE TABLE IF NOT EXISTS dauth(u TEXT, k TEXT, PRIMARY KEY(u,k));
CREATE TABLE IF NOT EXISTS storage(id TEXT PRIMARY KEY, j TEXT);''')
migrate_sqlite_to_pg()
PMAX = {'foundation': 250, 'floor': 200, 'wall': 200, 'doorway': 200, 'door': 200, 'mdoor': 450, 'cupboard': 150, 'box': 150, 'quarry': 300, 'furnace': 150}
REFUND = {'furnace': ('furnace', 1), 'foundation': ('wood', 10), 'floor': ('wood', 8), 'wall': ('wood', 10), 'doorway': ('wood', 10), 'door': ('door', 1), 'mdoor': ('mdoor', 1), 'cupboard': ('cupboard', 1), 'box': ('box', 1), 'quarry': ('quarry', 1)}
UPGR = ('foundation', 'floor', 'wall', 'doorway')
def pmax(b): return PMAX[b['k']] * (2 if b.get('u') else 1)
SATCHEL_DMG, SATCHEL_FUSE = 75, 8.7        # сатчел: 75 урона любой детали через ~8.7 с (10 писков)
def satchel_boom(pid):
    b = parts.get(pid)
    if not b: return
    h = phpd.get(pid, pmax(b)) - SATCHEL_DMG
    if h <= 0: destroy_part(pid); return
    phpd[pid] = h; q('INSERT OR REPLACE INTO bhp VALUES(?,?)', (pid, h)); broadcast({'t': 'bhp', 'id': pid, 'h': round(h, 1)})
GREN_DMG, GREN_R = 50, 3.4
RPG_DMG, RPG_R = 150, 4.0                  # РПГ: ракета, 150 урона каждой детали рядом                 # граната: 50 урона каждой детали рядом
def hit_part(pid, dmg):
    b = parts.get(pid)
    if not b: return
    h = phpd.get(pid, pmax(b)) - dmg
    if h <= 0: destroy_part(pid); return
    phpd[pid] = h; q('INSERT OR REPLACE INTO bhp VALUES(?,?)', (pid, h)); broadcast({'t': 'bhp', 'id': pid, 'h': round(h, 1)})
QUAR_CYC, QUAR_FUEL, QUAR_CAP, QUAR_MAXF = 5, 60, 600, 40   # карьер: цикл 5 с, 1 топливо = 60 с работы
QUAR_OUT = (('s', 4), ('m', 2), ('u', 1))                    # за цикл: камень 4, железо 2, сера 1
QRES = (('s', 'stone'), ('m', 'metal_ore'), ('u', 'sulfur_ore'))
def qstate(pid):
    st = stor.get(pid)
    if not isinstance(st, dict): st = {'f': 0, 's': 0, 'm': 0, 'u': 0}; stor[pid] = st
    return st
BUILD_DMG_K, CUP_R, DECAY_MIN, STOR_N = 0.1, 30.0, 180.0, 20
SLOCK = threading.Lock()
def jr(v): return int(math.floor(v + 0.5))
def ck(x, z, l): return f'{jr(x / 4)},{jr(z / 4)},{l}'
def ek(x, z, l): return f'{jr(x * 2 / 4)},{jr(z * 2 / 4)},{l}'
def part_id(b):
    k, x, z, l = b['k'], b['x'], b['z'], b['l']
    if k == 'foundation': return 'F:' + ck(x, z, l)
    if k == 'floor': return 'L:' + ck(x, z, l)
    if k == 'wall': return 'W:' + ek(x, z, l)
    if k == 'doorway': return 'D:' + ek(x, z, l)
    if k in ('door', 'mdoor'): return 'O:' + ek(x, z, l)
    return {'box': 'B:', 'quarry': 'Q:'}.get(k, 'C:') + f'{jr(x * 10)},{jr(z * 10)},{l}'
parts, prow = {}, {}
for _rid, _j in qa('SELECT id,j FROM builds ORDER BY id'):
    try: _b = json.loads(_j)
    except Exception: continue
    if _b.get('t') == 'dl':                 # старые замки переезжают в таблицу locks (код клиентам больше не рассылается)
        _c = str(_b.get('c') or '')
        if _c: q('INSERT OR REPLACE INTO locks VALUES(?,?)', (ek(_b['x'], _b['z'], _b['l']), _c))
        q('DELETE FROM builds WHERE id=?', (_rid,)); continue
    if _b.get('t') == 'bd' and _b.get('k') in PMAX:
        try: _pid = part_id(_b)
        except Exception: continue
        if _pid not in parts: parts[_pid] = _b; prow[_pid] = _rid
world['builds'][:] = list(parts.values())
phpd = {i: h for i, h in qa('SELECT id,h FROM bhp')}
locks = {k: c for k, c in qa('SELECT k,c FROM locks')}
dauth = set((u, k) for u, k in qa('SELECT u,k FROM dauth'))
stor = {}
for _i, _j in qa('SELECT id,j FROM storage'):
    try: stor[_i] = json.loads(_j)
    except Exception: pass

def dauth_drop(key):
    for e in [e for e in dauth if e[1] == key]: dauth.discard(e)
    q('DELETE FROM dauth WHERE k=?', (key,))
def add_bag(k, n, d, x, y, z):
    now = time.time()
    with DBL:
        cur = DB.execute('INSERT INTO bags(k,n,d,x,y,z,t,owner) VALUES(?,?,?,?,?,?,?,?)', (k, n, d, x, y, z, now, '')); DB.commit(); bid = cur.lastrowid
    bb = {'id': bid, 'k': k, 'n': n, 'd': d, 'x': x, 'y': y, 'z': z, 't': now}
    with LOCK: bags[bid] = bb
    broadcast({'t': 'bg', **bag_pub(bb)})

_ECELL = lambda b: ([(b['x'] - 2, b['z']), (b['x'] + 2, b['z'])] if abs(b.get('r', 0)) > 1e-3 else [(b['x'], b['z'] - 2), (b['x'], b['z'] + 2)])
def unsupported_ids():
    with LOCK: items = list(parts.items())
    cell, edge, fl, ed = {}, {}, [], []
    for pid, b in items:
        k = b['k']
        if k == 'foundation': cell[ck(b['x'], b['z'], b['l'])] = 0
        elif k == 'floor': fl.append(b)
        elif k in ('wall', 'doorway'): ed.append(b)
    ch = True
    while ch:
        ch = False
        for b in ed:
            key = ek(b['x'], b['z'], b['l'])
            if key in edge: continue
            ds = [cell[ck(cx, cz, b['l'])] for cx, cz in _ECELL(b) if ck(cx, cz, b['l']) in cell]
            if ds: edge[key] = min(ds) + 1; ch = True
        for b in fl:
            key = ck(b['x'], b['z'], b['l'])
            if key in cell: continue
            ds = [edge[ek(x, z, b['l'] - 1)] for x, z in ((b['x'] - 2, b['z']), (b['x'] + 2, b['z']), (b['x'], b['z'] - 2), (b['x'], b['z'] + 2)) if ek(x, z, b['l'] - 1) in edge]
            ds += [cell[ck(b['x'] + dx, b['z'] + dz, b['l'])] + 1 for dx, dz in ((4, 0), (-4, 0), (0, 4), (0, -4)) if ck(b['x'] + dx, b['z'] + dz, b['l']) in cell]
            if ds: cell[key] = min(ds) + 1; ch = True
    dead = []
    for pid, b in items:
        k = b['k']
        if k == 'foundation' or k == 'quarry': continue
        if k == 'floor': ok = ck(b['x'], b['z'], b['l']) in cell
        elif k in ('wall', 'doorway', 'door', 'mdoor'): ok = ek(b['x'], b['z'], b['l']) in edge
        elif k in ('box', 'cupboard'): ok = ck(jr(b['x'] / 4) * 4, jr(b['z'] / 4) * 4, b['l']) in cell or (b['l'] == 0 and ck(b['x'], b['z'], 0) not in {ck(c['x'], c['z'], 0) for _, c in items if c['k'] == 'foundation'})
        else: ok = True
        if not ok: dead.append(pid)
    return dead
def collapse_check():
    for _ in range(12):
        dead = unsupported_ids()
        if not dead: break
        for pid in dead: destroy_part(pid, False, False)
def destroy_part(pid, cascade=True, _chk=True):
    with LOCK:
        b = parts.pop(pid, None)
        if b:
            try: world['builds'].remove(b)
            except ValueError: pass
    if not b: return
    rid = prow.pop(pid, None)
    if rid: q('DELETE FROM builds WHERE id=?', (rid,))
    phpd.pop(pid, None); q('DELETE FROM bhp WHERE id=?', (pid,))
    broadcast({'t': 'bx', 'id': pid})
    if b['k'] == 'doorway' and cascade: destroy_part('O:' + pid[2:], False)
    if b['k'] in ('door', 'mdoor'):
        lk = pid[2:]
        if locks.pop(lk, None) is not None: q('DELETE FROM locks WHERE k=?', (lk,))
        dauth_drop(lk)
    if b['k'] == 'quarry':
        with SLOCK: st = stor.pop(pid, None)
        q('DELETE FROM storage WHERE id=?', (pid,))
        if isinstance(st, dict):
            for kk, name in QRES:
                if st.get(kk, 0) >= 1: add_bag(name, int(st[kk]), None, b['x'] + random.uniform(-.4, .4), b['y'] + 0.3, b['z'] + random.uniform(-.4, .4))
    if b['k'] in ('box', 'cupboard'):
        with SLOCK: items = stor.pop(pid, None)
        q('DELETE FROM storage WHERE id=?', (pid,))
        for sl in (items or []):
            if sl: add_bag(sl['k'], sl['n'], sl.get('d'), b['x'] + random.uniform(-.4, .4), b['y'] + 0.3, b['z'] + random.uniform(-.4, .4))
    if _chk and b['k'] in ('foundation', 'floor', 'wall', 'doorway'): collapse_check()
def decayer():                              # без шкафа в радиусе CUP_R деталь гниёт: полная потеря HP за DECAY_MIN минут
    while True:
        time.sleep(60)
        try:
            with LOCK: cups = [(b['x'], b['z']) for b in parts.values() if b['k'] == 'cupboard']; items = list(parts.items())
            ch, dead = [], []
            for pid, b in items:
                if any(math.hypot(b['x'] - cx, b['z'] - cz) <= CUP_R for cx, cz in cups): continue
                mx = pmax(b); h = phpd.get(pid, mx) - mx / DECAY_MIN
                if h <= 0: dead.append(pid)
                else: phpd[pid] = h; ch.append([pid, round(h, 1)])
            if ch:
                with DBL: DB.executemany('INSERT OR REPLACE INTO bhp VALUES(?,?)', [(i, phpd[i]) for i, _ in ch]); DB.commit()
                broadcast({'t': 'bhb', 'l': ch})
            for pid in dead: destroy_part(pid)
        except Exception as e: print('гниение:', e)
def quarry_loop():                          #   карьеры: каждые QUAR_CYC с жгут топливо и копят камень, железо, серу
    while True:
        time.sleep(QUAR_CYC)
        try:
            with LOCK: ids = [pid for pid, b in parts.items() if b['k'] == 'quarry']
            act = []
            for pid in ids:
                with SLOCK:
                    st = qstate(pid)
                    if st['f'] <= 0: continue
                    act.append(pid)
                    st['f'] = max(0, st['f'] - QUAR_CYC)
                    for kk, v in QUAR_OUT: st[kk] = min(QUAR_CAP, st[kk] + v)
                    snap = dict(st)
                q('INSERT OR REPLACE INTO storage VALUES(?,?)', (pid, json.dumps(snap, separators=(',', ':'))))
                with LOCK: viewers = [c for c in clients.values() if getattr(c, 'quar', None) == pid]
                for c in viewers: c.send({'t': 'qs', 'id': pid, **snap})
            broadcast({'t': 'qa', 'ids': act})
        except Exception as e: print('quarry:', e)
def bag_sweeper():
    while True:
        time.sleep(30)
        with LOCK: dead = [i for i, b in bags.items() if time.time() - b['t'] > BAG_TTL]; [bags.pop(i) for i in dead]
        for i in dead: q('DELETE FROM bags WHERE id=?', (i,)); broadcast({'t': 'bgx', 'id': i})

def load_profile(tok):
    r = qa('SELECT x,y,z,hp,hu,th,st,inv FROM players WHERE tok=?', (tok,))
    if not r: return None
    x, y, z, hp, hu, th, st, inv = r[0]
    d = json.loads(inv) if inv else {}
    return {'x': x, 'y': y, 'z': z, 'hp': hp, 'hu': hu, 'th': th, 'st': st, **d}

def save_profile(cl, p=None):
    if not cl.tok: return
    p = p or {}; pos = cl.st[:3] if cl.st else [None] * 3
    inv = json.dumps({k: p[k] for k in ('g', 'h', 'e') if k in p}, separators=(',', ':')) if 'g' in p else None
    q('''INSERT INTO players(tok,name,x,y,z,hp,hu,th,st,inv,first,seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tok) DO UPDATE SET name=excluded.name, x=COALESCE(excluded.x,players.x), y=COALESCE(excluded.y,players.y), z=COALESCE(excluded.z,players.z),
         hp=COALESCE(excluded.hp,players.hp), hu=COALESCE(excluded.hu,players.hu), th=COALESCE(excluded.th,players.th), st=COALESCE(excluded.st,players.st),
         inv=COALESCE(excluded.inv,players.inv), playtime=players.playtime+?, seen=excluded.seen''',
      (cl.tok, cl.name, pos[0], pos[1], pos[2], p.get('hp'), p.get('hu'), p.get('th'), p.get('st'), inv, time.time(), time.time(),
       int(time.time() - cl.saved_at)))
    cl.saved_at = time.time()

def frame(text):
    d = text.encode(); n = len(d)
    h = b'\x81' + (bytes([n]) if n < 126 else b'\x7e' + struct.pack('>H', n) if n < 65536 else b'\x7f' + struct.pack('>Q', n))
    return h + d

class Client:
    def __init__(self, sock, ip=''): self.sock = sock; self.ip = ip; self.tok = ''; self.last_hit = 0; self.saved_at = time.time(); self.id = 0; self.name = ''; self.st = None; self.alive = True; self.wl = threading.Lock()
    def send(self, obj):
        try:
            with self.wl: self.sock.sendall(frame(json.dumps(obj, separators=(',', ':'))))
        except OSError: self.alive = False

# ---------- серверная добыча и лут (сервер — единственный источник истины) ----------
NODES = {'wood': (50, 6, 10), 'stone': (50, 8, 14), 'sulfur': (50, 6, 10), 'metal': (50, 5, 9), 'cloth': (30, 2, 5), 'scrap': (40, 7, 14)}
GOOD = {'axe': ('wood', 'cloth'), 'pickaxe': ('stone', 'sulfur', 'metal')}
BARREL_LOOT = [('ammo_rifle', 0.22, 6, 14), ('ammo_pistol', 0.22, 6, 12), ('metal', 0.30, 5, 15), ('gear', 0.10, 1, 1),
               ('pipe', 0.10, 1, 2), ('gunpowder', 0.12, 2, 5), ('fuel', 0.08, 1, 1), ('nails', 0.12, 4, 10)]
WDMG = {'rock': 10, 'rifle': 20, 'pistol': 25, 'berdanka': 35, 'smg': 18, 'axe': 15, 'pickaxe': 12, 'spear': 25}
GUNS_W = ('rifle', 'pistol', 'berdanka', 'smg')
node_types = {}
def broadcast(obj, skip=None):
    with LOCK: t = [c for c in clients.values() if c is not skip]
    for c in t: c.send(obj)
def say(s): broadcast({'t': 'c', 'n': '', 'm': s})

def ticker():
    while True:
        time.sleep(0.05)   # 20 Гц рассылка позиций
        with LOCK: lst = [[c.id] + c.st for c in clients.values() if c.st]; t = list(clients.values())
        if lst:
            for c in t: c.send({'t': 'ps', 'p': lst})

def read_frame(rf, cl):
    while True:
        h = rf.read(2)
        if len(h) < 2: return None
        op = h[0] & 15; ln = h[1] & 127
        if ln == 126: ln = struct.unpack('>H', rf.read(2))[0]
        elif ln == 127: ln = struct.unpack('>Q', rf.read(8))[0]
        if ln > 1 << 20: return None
        mask = rf.read(4) if h[1] & 128 else b''
        data = rf.read(ln)
        if len(data) < ln: return None
        if mask: data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        if op == 8: return None
        if op == 9:
            try:
                with cl.wl: cl.sock.sendall(b'\x8a\x00')
            except OSError: return None
            continue
        if op == 1: return data.decode('utf-8', 'replace')

def handle_msg(cl, m):
    t = m.get('t')
    if t == 'join':
        u = session_user(m.get('k'))
        if not u: cl.send({'t': 'auth'}); cl.alive = False; return
        if banned(u, cl.ip) is not None: cl.send({'t': 'kick', 'm': 'Вы заблокированы на этом сервере'}); cl.alive = False; return
        with LOCK:
            old = [c for c in clients.values() if c.tok == u]
            for c in old: clients.pop(c.id, None)
        for c in old: c.send({'t': 'kick', 'm': 'Вход с другого устройства'}); c.kick()
        with LOCK:
            full = len(clients) >= MAXP
            if not full:
                cl.id = _id[0]; _id[0] += 1
                cl.name = u; cl.tok = u
                others = [{'id': c.id, 'n': c.name} for c in clients.values()]
                clients[cl.id] = cl
                snap = {'dead': list(world['dead']), 'hp': dict(world['hp']), 'builds': list(world['builds']), 'bags': [bag_pub(b) for b in bags.values()],
                        'bhp': {k: round(v, 1) for k, v in phpd.items()}, 'locks': list(locks), 'auth': [k for uu, k in dauth if uu == u]}
        if full: cl.send({'t': 'full'}); cl.alive = False; return
        cl.saved_at = time.time()
        cl.send({'t': 'w', 'id': cl.id, 'ver': VER, 'name': NAME, 'you': u, 'players': others, 'me': load_profile(cl.tok) if cl.tok else None, **snap})
        broadcast({'t': 'pj', 'id': cl.id, 'n': cl.name}, skip=cl)
        say(cl.name + ' зашёл на сервер'); print(f'+ {cl.name}  [{len(clients)}/{MAXP}]'); return
    if not cl.id: return
    if t == 'st':
        s = m.get('s')
        if isinstance(s, list) and len(s) == 7: cl.st = s
    elif t == 'hr':                         # добыча ресурса: урон по узлу, количество и лут считает сервер
        i, ty, tool = m.get('i'), m.get('ty'), m.get('k'); now = time.time()
        if not (isinstance(i, int) and 0 <= i < 200000 and ty in NODES) or now - getattr(cl, 'last_hr', 0) < 0.3: return
        cl.last_hr = now
        with LOCK:
            if i in world['dead']: return
            ty = node_types.setdefault(i, ty)
            hp = world['hp'].get(str(i), NODES[ty][0])
        _, lo, hi = NODES[ty]
        if ty == 'scrap': mult, crit, dmg = 1, False, 20
        else:
            mult = 0.6 if tool == 'spear' else (1 if ty in GOOD.get(tool, ()) else 0.5)
            crit = False; dmg = 20 * max(0.6, mult)
        take = 0
        if ty in ('wood', 'stone', 'sulfur', 'metal'):            # 50 ресурса на узел, 3–5 за удар, остаток делится без хвоста
            L = max(1, min(50, int(hp)))
            if L <= 5: take = L
            else: lo, hi = max(3, L - 5), min(5, L - 3); take = random.randint(lo, hi)
            dmg = take
        hp -= dmg; loot = []
        if ty == 'scrap':
            if hp <= 0:
                loot.append(('scrap', random.randint(lo, hi)))
                loot += [(k, random.randint(a, b)) for k, ch, a, b in BARREL_LOOT if random.random() < ch]
        else:
            n = max(1, int(take * mult)) if take else max(1, int((lo + random.random() * (hi - lo)) * mult)); loot.append(({'metal': 'metal_ore', 'sulfur': 'sulfur_ore'}.get(ty, ty), n * (2 if crit else 1)))
        for k, n in loot: cl.send({'t': 'got', 'k': k, 'n': n, 'srv': 1, 'c': 1 if crit else 0})
        if hp <= 0:
            with LOCK:
                world['dead'].append(i); world['hp'].pop(str(i), None); node_types.pop(i, None)
            q('INSERT OR REPLACE INTO dead VALUES(?,?)', (i, now)); q('DELETE FROM res_hp WHERE i=?', (i,)); broadcast({'t': 'hv', 'i': i})
        else:
            with LOCK: world['hp'][str(i)] = round(hp)
            q('INSERT OR REPLACE INTO res_hp VALUES(?,?)', (i, round(hp))); broadcast({'t': 'hh', 'i': i, 'h': round(hp)})
    elif t == 'hv':
        return                              # клиентам больше не доверяем: узлы ломает только сервер
        i = m.get('i')
        if isinstance(i, int):
            with LOCK:
                new = i not in world['dead']
                if new: world['dead'].append(i); world['hp'].pop(str(i), None)
            if new:
                q('INSERT OR REPLACE INTO dead VALUES(?,?)', (i, time.time())); q('DELETE FROM res_hp WHERE i=?', (i,)); broadcast(m, skip=cl)
    elif t == 'hh':
        return
        if isinstance(m.get('i'), int) and isinstance(m.get('h'), (int, float)):
            with LOCK: world['hp'][str(m['i'])] = m['h']
            q('INSERT OR REPLACE INTO res_hp VALUES(?,?)', (m['i'], m['h'])); broadcast(m, skip=cl)
    elif t in ('dr', 'dl', 'du'):            # дверь: открыть/закрыть, поставить/снять замок, ввести код
        if not all(isinstance(m.get(k), (int, float)) for k in ('x', 'z', 'l')): return
        key = ek(m['x'], m['z'], m['l']); now = time.time()
        if 'O:' + key not in parts or not cl.st or math.hypot(m['x'] - cl.st[0], m['z'] - cl.st[2]) > 8: return
        auth = (cl.tok, key) in dauth; msg = {'x': m['x'], 'z': m['z'], 'l': m['l']}
        if t == 'du':
            if now - getattr(cl, 'last_du', 0) < 0.5: cl.send({'t': 'dno', **msg}); return
            cl.last_du = now
            if key in locks and locks[key] == str(m.get('c') or ''):
                dauth.add((cl.tok, key)); q('INSERT OR IGNORE INTO dauth VALUES(?,?)', (cl.tok, key)); cl.send({'t': 'dok', **msg})
            else: cl.send({'t': 'dno', **msg})
        elif t == 'dl':
            c = str(m.get('c') or '')[:4]
            if (key in locks and not auth) or (c and not re.fullmatch(r'\d{4}', c)):
                cl.send({'t': 'dno', **msg}); cl.send({'t': 'dl', **msg, 'c': 1 if key in locks else 0}); return
            dauth_drop(key)
            if c:
                locks[key] = c; q('INSERT OR REPLACE INTO locks VALUES(?,?)', (key, c))
                dauth.add((cl.tok, key)); q('INSERT OR IGNORE INTO dauth VALUES(?,?)', (cl.tok, key)); cl.send({'t': 'dok', **msg})
            else: locks.pop(key, None); q('DELETE FROM locks WHERE k=?', (key,))
            broadcast({'t': 'dl', **msg, 'c': 1 if c else 0}, skip=cl)
        else:
            if key in locks and not auth: cl.send({'t': 'dno', **msg}); cl.send({'t': 'dr', **msg, 'o': 0}); return
            broadcast({'t': 'dr', **msg, 'o': 1 if m.get('o') else 0}, skip=cl)
    elif t == 'bd':                         # постройка: id детали считает сервер, дубликаты отбрасываются
        try: b = {'t': 'bd', 'k': m['k'], 'x': float(m['x']), 'y': float(m['y']), 'z': float(m['z']), 'r': float(m.get('r') or 0), 'l': int(m['l']), 'b': float(m.get('b') or 0), 'tm': int(time.time() * 1000)}
        except (KeyError, TypeError, ValueError): return
        if b['k'] not in PMAX or not all(math.isfinite(b[k]) for k in ('x', 'y', 'z', 'r', 'b')): return
        pid = part_id(b)
        if pid in parts: return
        with LOCK: parts[pid] = b; world['builds'].append(b)
        with DBL: cur = DB.execute('INSERT INTO builds(j) VALUES(?)', (json.dumps(b, separators=(',', ':')),)); DB.commit(); prow[pid] = cur.lastrowid
        broadcast(b, skip=cl)
    elif t == 'bh':                         # удар/выстрел по детали: урон = 1/10 от урона по человеку
        pid, w, now = m.get('id'), m.get('w'), time.time()
        b = parts.get(pid) if isinstance(pid, str) else None
        if not b or w not in WDMG or not cl.st or now - getattr(cl, 'last_bh', 0) < 0.08: return
        if math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > (300 if w in GUNS_W else 7): return
        cl.last_bh = now
        h = phpd.get(pid, pmax(b)) - WDMG[w] * BUILD_DMG_K
        if h <= 0: destroy_part(pid); return
        phpd[pid] = h; q('INSERT OR REPLACE INTO bhp VALUES(?,?)', (pid, h)); broadcast({'t': 'bhp', 'id': pid, 'h': round(h, 1)})
    elif t == 'sx':                         # сатчел прилеплен к детали: взрыв через SATCHEL_FUSE секунд
        pid, now = m.get('id'), time.time()
        b = parts.get(pid) if isinstance(pid, str) else None
        if not b or not cl.st or now - getattr(cl, 'last_sx', 0) < 1.0: return
        try: pp = [round(float(v), 3) for v in m.get('p')][:3]; qq = [round(float(v), 3) for v in m.get('q')][:3]
        except Exception: return
        if len(pp) != 3 or len(qq) != 3 or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 20: return
        cl.last_sx = now
        broadcast({'t': 'sxp', 'id': pid, 'p': pp, 'q': qq}, skip=cl)
        tm_ = threading.Timer(SATCHEL_FUSE, satchel_boom, (pid,)); tm_.daemon = True; tm_.start()
    elif t == 'bz':                         # снос/подбор киянкой: только в течение 10 минут после постройки
        pid = m.get('id'); b = parts.get(pid) if isinstance(pid, str) else None
        if not b or not cl.st or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 8: return
        if not b.get('tm') or time.time() * 1000 - b['tm'] > 600000: return
        rk, rn = REFUND[b['k']]
        destroy_part(pid); cl.send({'t': 'got', 'k': rk, 'n': rn})
    elif t == 'bu':                         # улучшение в камень: ×2 прочность
        pid = m.get('id'); b = parts.get(pid) if isinstance(pid, str) else None
        if not b or b['k'] not in UPGR or b.get('u') or not cl.st or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 8: return
        mx = PMAX[b['k']]; b['u'] = 1
        h = phpd.get(pid, mx) + mx; phpd[pid] = h
        rid = prow.get(pid)
        if rid: q('UPDATE builds SET j=? WHERE id=?', (json.dumps(b, separators=(',', ':')), rid))
        q('INSERT OR REPLACE INTO bhp VALUES(?,?)', (pid, h))
        broadcast({'t': 'bu', 'id': pid}); broadcast({'t': 'bhp', 'id': pid, 'h': round(h, 1)})
    elif t == 'br':                         # починка киянкой за ресурс
        pid = m.get('id'); b = parts.get(pid) if isinstance(pid, str) else None
        if not b or b['k'] not in PMAX or not cl.st or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 8: return
        h = PMAX[b['k']] * (2 if b.get('u') else 1); phpd[pid] = h
        q('INSERT OR REPLACE INTO bhp VALUES(?,?)', (pid, h)); broadcast({'t': 'bhp', 'id': pid, 'h': round(h, 1)})
    elif t == 'gx':                         # граната: эффект остальным, 50 урона каждой детали рядом
        now = time.time()
        try: pp = [round(float(v), 2) for v in m.get('p')][:3]
        except Exception: return
        if len(pp) != 3 or not cl.st or not all(math.isfinite(v) for v in pp) or math.hypot(pp[0] - cl.st[0], pp[2] - cl.st[2]) > 60 or now - getattr(cl, 'last_gx', 0) < 0.4: return
        cl.last_gx = now
        broadcast({'t': 'gxp', 'p': pp}, skip=cl)
        with LOCK: near = [pid for pid, b in parts.items() if math.hypot(b['x'] - pp[0], b['z'] - pp[2]) <= GREN_R and abs(b['y'] - pp[1]) <= 3.2]
        for pid in near: hit_part(pid, GREN_DMG)
    elif t == 'rx':                         # ракета РПГ: эффект остальным, 150 урона каждой детали рядом
        now = time.time()
        try: pp = [round(float(v), 2) for v in m.get('p')][:3]
        except Exception: return
        if len(pp) != 3 or not cl.st or not all(math.isfinite(v) for v in pp) or math.hypot(pp[0] - cl.st[0], pp[2] - cl.st[2]) > 320 or now - getattr(cl, 'last_rx', 0) < 0.8: return
        cl.last_rx = now
        broadcast({'t': 'rxp', 'p': pp}, skip=cl)
        rid = m.get('id')
        with LOCK:
            near = {pid for pid, b in parts.items() if math.hypot(b['x'] - pp[0], b['z'] - pp[2]) <= RPG_R and abs(b['y'] - pp[1]) <= 3.5}
            if isinstance(rid, str) and rid in parts and math.hypot(parts[rid]['x'] - pp[0], parts[rid]['z'] - pp[2]) <= 8: near.add(rid)
        for pid in near: hit_part(pid, RPG_DMG)
    elif t in ('qo', 'qf', 'qt'):           # карьер: открыть / залить топливо / забрать добычу (всё считает сервер)
        pid = m.get('id'); b = parts.get(pid) if isinstance(pid, str) else None
        try: nf = max(1, min(QUAR_MAXF, int(m.get('n') or 1)))
        except (TypeError, ValueError): nf = 1
        if not b or b['k'] != 'quarry' or not cl.st or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 8:
            if t == 'qf': cl.send({'t': 'got', 'k': 'fuel', 'n': nf, 'back': 1})
            return
        with SLOCK:
            st = qstate(pid)
            if t == 'qo': cl.quar = pid
            elif t == 'qf':
                add = min(nf, max(0, QUAR_MAXF - int(math.ceil(st['f'] / QUAR_FUEL))))
                st['f'] += add * QUAR_FUEL
                if add < nf: cl.send({'t': 'got', 'k': 'fuel', 'n': nf - add, 'back': 1})
            else:
                for kk, name in QRES:
                    if st[kk] >= 1: cl.send({'t': 'got', 'k': name, 'n': int(st[kk])}); st[kk] -= int(st[kk])
            snap = dict(st)
        if t != 'qo': q('INSERT OR REPLACE INTO storage VALUES(?,?)', (pid, json.dumps(snap, separators=(',', ':'))))
        cl.send({'t': 'qs', 'id': pid, **snap})
    elif t in ('so', 'sp', 'sk'):           # ящик: открыть / положить / взять — содержимое хранит и считает сервер
        pid = m.get('id'); b = parts.get(pid) if isinstance(pid, str) else None
        k, n, d = m.get('k'), m.get('n'), m.get('d')
        if not b or b['k'] not in ('box', 'cupboard') or not cl.st or math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) > 6:
            if t == 'sp' and isinstance(k, str) and isinstance(n, int) and 0 < n < 10000: cl.send({'t': 'got', 'k': k, 'n': n, **({'d': d} if d is not None else {}), 'back': 1})
            return
        with SLOCK:
            sl = stor.setdefault(pid, [None] * STOR_N)
            if len(sl) < STOR_N: sl += [None] * (STOR_N - len(sl))
            if t == 'so': cl.box = pid
            elif t == 'sp':
                if not (isinstance(k, str) and ITEMK.match(k) and isinstance(n, int) and 0 < n < 10000): return
                try: cap = max(1, min(1000, int(m.get('cap') or 1)))
                except (TypeError, ValueError): cap = 1
                if d is not None and not isinstance(d, (int, float)): d = None
                left = n
                if d is None:
                    for x in sl:
                        if left and x and x['k'] == k and x.get('d') is None and x['n'] < cap: a = min(cap - x['n'], left); x['n'] += a; left -= a
                for i in range(STOR_N):
                    if not left: break
                    if sl[i] is None:
                        a = min(cap, left); sl[i] = {'k': k, 'n': a}
                        if d is not None: sl[i]['d'] = d
                        left -= a
                if left: cl.send({'t': 'got', 'k': k, 'n': left, **({'d': d} if d is not None else {}), 'back': 1})
            else:
                i = m.get('i')
                if isinstance(i, int) and 0 <= i < STOR_N and sl[i]:
                    x = sl[i]; sl[i] = None; cl.send({'t': 'got', 'k': x['k'], 'n': x['n'], **({'d': x['d']} if x.get('d') is not None else {})})
            snap = list(sl)
        if t != 'so': q('INSERT OR REPLACE INTO storage VALUES(?,?)', (pid, json.dumps(snap, separators=(',', ':'))))
        with LOCK: viewers = [c for c in clients.values() if getattr(c, 'box', None) == pid]
        for c in viewers: c.send({'t': 'sc', 'id': pid, 's': snap})
    elif t == 'pf':
        save_profile(cl, m)
    elif t == 'drop':                       # выбросить предмет → мешочек
        k, n = m.get('k'), m.get('n'); now = time.time()
        try: x, y, z, d = float(m['x']), float(m['y']), float(m['z']), (float(m['d']) if m.get('d') is not None else None)
        except (KeyError, TypeError, ValueError): return
        ok = isinstance(k, str) and ITEMK.match(k) and isinstance(n, int) and 0 < n < 10000 and now - getattr(cl, 'last_drop', 0) > 0.15
        if ok and cl.st and (math.hypot(x - cl.st[0], z - cl.st[2]) > 6 or abs(y - cl.st[1]) > 10): ok = False
        if not ok:                          # отклонено — возвращаем предмет владельцу, чтобы ничего не пропало
            if isinstance(k, str) and isinstance(n, int) and 0 < n < 10000: cl.send({'t': 'got', 'k': k, 'n': n, 'd': d, 'back': 1})
            return
        cl.last_drop = now
        with DBL:
            cur = DB.execute('INSERT INTO bags(k,n,d,x,y,z,t,owner) VALUES(?,?,?,?,?,?,?,?)', (k, n, d, x, y, z, now, cl.tok)); DB.commit(); bid = cur.lastrowid
        b = {'id': bid, 'k': k, 'n': n, 'd': d, 'x': x, 'y': y, 'z': z, 't': now}
        with LOCK:
            bags[bid] = b
            old = sorted(bags, key=lambda i: bags[i]['t'])[:max(0, len(bags) - BAG_MAX)]; [bags.pop(i) for i in old]
        for i in old: q('DELETE FROM bags WHERE id=?', (i,)); broadcast({'t': 'bgx', 'id': i})
        broadcast({'t': 'bg', **bag_pub(b)}); print(f'[выброс] {cl.name}: {k} x{n}')
    elif t == 'pk':                         # подобрать мешочек (кто первый — тот и забрал)
        bid = m.get('id')
        if not isinstance(bid, int): return
        with LOCK:
            b = bags.get(bid)
            near = b and cl.st and math.hypot(b['x'] - cl.st[0], b['z'] - cl.st[2]) <= 4.5 and abs(b['y'] - cl.st[1]) <= 6
            if near: bags.pop(bid)
        if near:
            q('DELETE FROM bags WHERE id=?', (bid,)); cl.send({'t': 'got', 'k': b['k'], 'n': b['n'], 'd': b['d']})
            broadcast({'t': 'bgx', 'id': bid}); print(f'[подбор] {cl.name}: {b["k"]} x{b["n"]}')
    elif t in ('sh', 'sw'): broadcast({'t': t, 'id': cl.id}, skip=cl)
    elif t == 'hit':
        w = m.get('w'); now = time.time()
        with LOCK: v = clients.get(m.get('to'))
        if w not in WDMG or not v or v is cl or now - cl.last_hit < 0.08 or not (cl.st and v.st): return
        dist = math.dist(cl.st[:3], v.st[:3])
        if dist > (300 if w in GUNS_W else 5): return                      # дальность проверяет сервер
        d = WDMG[w] * (2 if (w in GUNS_W and m.get('hd')) else 1)
        cl.last_hit = now; v.send({'t': 'dmg', 'from': cl.id, 'd': d, 'fn': cl.name})
    elif t == 'die':
        with LOCK: k = clients.get(m.get('by'))
        q('UPDATE players SET deaths=deaths+1 WHERE tok=?', (cl.tok,))
        if k and k is not cl: q('UPDATE players SET kills=kills+1 WHERE tok=?', (k.tok,))
        say((k.name + ' убил ' + cl.name) if k else (cl.name + ' погиб'))
    elif t == 'c':
        txt = str(m.get('m', ''))[:120].strip()
        if txt:
            q('INSERT INTO chatlog(t,u,m) VALUES(?,?,?)', (time.time(), cl.name, txt)); broadcast({'t': 'c', 'n': cl.name, 'm': txt})
            print(f'[чат] {cl.name}: {txt}')

def ws_session(h):
    ip = h.cip()
    with AL:
        if wsips.get(ip, 0) >= 6: return
        wsips[ip] = wsips.get(ip, 0) + 1
    key = h.headers.get('Sec-WebSocket-Key', '')
    acc = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    h.wfile.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % acc).encode()); h.wfile.flush()
    h.connection.settimeout(60); cl = Client(h.connection, ip)
    try:
        while cl.alive:
            txt = read_frame(h.rfile, cl)
            if txt is None: break
            try: handle_msg(cl, json.loads(txt))
            except (ValueError, TypeError, AttributeError): pass
    except (OSError, struct.error): pass
    finally:
        cl.alive = False
        with AL: wsips[ip] = max(0, wsips.get(ip, 1) - 1)
        if cl.id:
            with LOCK: clients.pop(cl.id, None)
            try: save_profile(cl)
            except Exception as e: print('save error', e)
            broadcast({'t': 'pl', 'id': cl.id}); say(cl.name + ' вышел'); print(f'- {cl.name}  [{len(clients)}/{MAXP}]')

def lan_ips():
    ips = []
    for target in ('8.8.8.8', '10.255.255.255', '192.168.255.255', '172.31.255.255'):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((target, 1)); ip = s.getsockname()[0]
            p = ip.split('.')
            if ip not in ips and (p[0] in ('10', '192') and (p[0] != '192' or p[1] == '168') or (p[0] == '172' and 16 <= int(p[1]) <= 31)): ips.append(ip)
        except OSError: pass
        finally: s.close()
    return ips or ['127.0.0.1']

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*'); super().end_headers()
    def log_message(self, *a): pass
    def cip(self):
        if PROXY:
            x = self.headers.get('X-Forwarded-For', '').split(',')[0].strip()
            if x: return x
        return self.client_address[0]
    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Headers', 'Content-Type'); self.send_header('Access-Control-Allow-Methods', 'GET, POST'); self.end_headers()
    def do_POST(self):
        p = self.path.split('?')[0]
        try: n = int(self.headers.get('Content-Length', 0)); d = json.loads(self.rfile.read(n).decode()) if 0 < n <= 2048 else None
        except (ValueError, OSError): d = None
        if not isinstance(d, dict): return self.reply(400, {'error': 'Некорректный запрос'})
        if p in ('/api/register', '/api/login'):
            code, obj = api_auth(p[5:], d, self.cip()); return self.reply(code, obj)
        self.send_error(404)
    def do_GET(self):
        p = self.path.split('?')[0]
        h = self.headers.get('Host', '').rsplit(':', 1)[0]
        if h in ('localhost', '127.0.0.1') and LAN[0] != '127.0.0.1' and not p.startswith(('/api/', '/ws')):
            self.send_response(302); self.send_header('Location', f'http://{LAN[0]}:{PORT}{self.path}'); self.end_headers(); return   # у всех один адрес
        if p == '/ws' and 'websocket' in self.headers.get('Upgrade', '').lower(): return ws_session(self)
        if p == '/api/info':
            with LOCK: n = len(clients)
            b = json.dumps({'name': NAME, 'port': PORT, 'cur': n, 'max': MAXP, 'ver': VER, 'reg': not NOREG, 'db': 'postgres' if PG else 'sqlite'}, ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if p == '/api/top':
            rows = qa('SELECT name,kills,deaths,playtime FROM players ORDER BY kills DESC, playtime DESC LIMIT 10')
            b = json.dumps([{'name': r[0], 'kills': r[1], 'deaths': r[2], 'min': r[3] // 60} for r in rows], ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if os.path.basename(p).startswith(('anode.db', 'server.', 'serve.', 'start.')) or p.startswith('/backups'): return self.send_error(404)
        super().do_GET()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True
    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], OSError): super().handle_error(request, client_address)   # обрыв связи — не шумим

try: srv = Server(('0.0.0.0', PORT), functools.partial(Handler, directory=ROOT))
except OSError: sys.exit(f'Порт {PORT} занят (старый сервер ещё работает).\nВыполни:  pkill -f server.py   и запусти снова.')

LAN = lan_ips()
BK = os.path.join(DATA, 'backups')
def backup_db():
    if PG: return 'PostgreSQL (бэкапы делает хостинг базы)'
    os.makedirs(BK, exist_ok=True); dst = os.path.join(BK, time.strftime('anode-%Y%m%d-%H%M%S.db'))
    with DBL:
        d = sqlite3.connect(dst); DB.backup(d); d.close()
    old = sorted(f for f in os.listdir(BK) if f.endswith('.db'))[:-7]
    for f in old: os.remove(os.path.join(BK, f))
    return dst
def auto_backup():
    while True:
        time.sleep(6 * 3600)
        try: backup_db()
        except Exception as e: print('Ошибка бэкапа:', e)
def find_client(a):
    with LOCK:
        for c in clients.values():
            if a == str(c.id) or a.casefold() == c.name.casefold(): return c
def console():
    for line in sys.stdin:
        cmd, _, arg = line.strip().partition(' '); arg = arg.strip(); args = arg.split()
        try:
            if cmd in ('help', '?'): print('status | players | accounts | kick <ник> | ban <ник> [причина] | banip <ip> | unban <ник|ip> | bans | passwd <ник> <новый пароль> | delacc <ник> | say <текст> | backup | stop')
            elif cmd == 'status':
                print(f'«{NAME}»: {len(clients)}/{MAXP} онлайн, аккаунтов: {qa("SELECT COUNT(*) FROM accounts")[0][0]}, построек: {len(world["builds"])}, аптайм: {int(time.time() - T0)} c')
            elif cmd == 'players':
                with LOCK: rows = [f'#{c.id} {c.name} ({c.ip})' for c in clients.values()]
                print('\n'.join(rows) or 'Никого нет онлайн')
            elif cmd == 'accounts':
                for r in qa('SELECT u,created,last_login,last_ip FROM accounts ORDER BY last_login DESC'):
                    print(f'{r[0]:<18} создан {time.strftime("%d.%m.%y", time.localtime(r[1]))}  вход {time.strftime("%d.%m.%y %H:%M", time.localtime(r[2]))}  {r[3]}')
            elif cmd == 'kick':
                c = find_client(arg)
                if c: c.send({'t': 'kick', 'm': 'Вас выгнал администратор'}); c.kick(); print('Кикнут', c.name)
                else: print('Не найден')
            elif cmd == 'ban' and args:
                a = find_acc(args[0])
                if not a: print('Аккаунт не найден'); continue
                q('INSERT OR REPLACE INTO bans VALUES(?,?,?,?)', ('user', a[0].casefold(), ' '.join(args[1:]), time.time())); q('DELETE FROM sessions WHERE u=?', (a[0],))
                c = find_client(a[0])
                if c: c.send({'t': 'kick', 'm': 'Вы заблокированы'}); c.kick()
                print('Забанен', a[0])
            elif cmd == 'banip' and args: q('INSERT OR REPLACE INTO bans VALUES(?,?,?,?)', ('ip', args[0], '', time.time())); print('IP забанен')
            elif cmd == 'unban' and args:
                q('DELETE FROM bans WHERE v=?', (args[0].casefold(),)); q('DELETE FROM bans WHERE v=?', (args[0],)); print('Разбанен (если был)')
            elif cmd == 'bans':
                for r in qa('SELECT kind,v,reason FROM bans'): print(f'{r[0]}: {r[1]} {r[2]}')
            elif cmd == 'passwd' and len(args) >= 2:
                a = find_acc(args[0])
                if not a: print('Аккаунт не найден'); continue
                salt = secrets.token_bytes(16); pw = ' '.join(args[1:])
                q('UPDATE accounts SET salt=?, h=? WHERE u=?', (salt, pw_hash(pw, salt), a[0])); q('DELETE FROM sessions WHERE u=?', (a[0],)); print('Пароль изменён для', a[0])
            elif cmd == 'delacc' and args:
                a = find_acc(args[0])
                if not a: print('Аккаунт не найден'); continue
                for t_, k_ in (('accounts', 'u'), ('sessions', 'u'), ('players', 'tok')): q(f'DELETE FROM {t_} WHERE {k_}=?', (a[0],))
                c = find_client(a[0])
                if c: c.kick()
                print('Аккаунт удалён:', a[0])
            elif cmd == 'say' and arg: broadcast({'t': 'c', 'n': '', 'm': '[Сервер] ' + arg})
            elif cmd == 'backup': print('Копия базы:', backup_db())
            elif cmd == 'stop': os.kill(os.getpid(), 2)
            elif cmd: print('Неизвестная команда. help — список')
        except Exception as e: print('Ошибка команды:', e)
T0 = time.time()
for _f in (ticker, auto_backup, console, bag_sweeper, decayer, quarry_loop): threading.Thread(target=_f, daemon=True).start()
try: backup_db()
except Exception as _e: print('Бэкап не создан:', _e)
print(f'=== «{NAME}» — макс. игроков: {MAXP} ===')
print(f'База: {"PostgreSQL" if PG else DBF}  (построек: {len(world["builds"])}, уничтожено ресурсов: {len(world["dead"])})')
for ip in LAN: print(f'>>> АДРЕС ДЛЯ ВСЕХ (и для тебя тоже): http://{ip}:{PORT}/')
if LAN[0] == '127.0.0.1': print('!!! Нет сети Wi-Fi/хотспота — включи раздачу или подключись к Wi-Fi')
print('Команды администратора: help  |  Остановка: Ctrl+C  (НЕ Ctrl+Z!)  |  Инструкция: server.txt')
try: srv.serve_forever()
except KeyboardInterrupt: print('\nОстановлено.')
finally:
    for c in list(clients.values()):
        try: save_profile(c)
        except Exception: pass
    DB.close()
