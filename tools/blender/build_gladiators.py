"""Arena4Ai gladiators — bespoke, fully procedural robot models.

Run headless:
    blender -b -P tools/blender/build_gladiators.py -- --out docs/v2-drafts [--render]

Everything is generated from the profile tables below: no downloaded assets, no
third-party meshes. Output is one GLB holding a rigid joint hierarchy per robot
(`<name>_hips`, `<name>_spine`, `<name>_shL` ...), which the web arena and the
reel pose by joint name.

Authoring space is the arena's own: x right, y up, z toward the viewer, in arena
units (a robot stands ~9.5 units tall). Vertices are converted to Blender's
z-up space on the way in, and the glTF exporter converts them straight back.
"""
import bpy, bmesh, math, sys, os

# ----------------------------------------------------------------------------- geometry kit

def sgnpow(c, n):
    return math.copysign(abs(c) ** (2.0 / n), c)

def rot_xyz(p, r):
    x, y, z = p
    if r[0]:
        c, s = math.cos(r[0]), math.sin(r[0]); y, z = y * c - z * s, y * s + z * c
    if r[1]:
        c, s = math.cos(r[1]), math.sin(r[1]); x, z = x * c + z * s, -x * s + z * c
    if r[2]:
        c, s = math.cos(r[2]), math.sin(r[2]); x, y = x * c - y * s, x * s + y * c
    return (x, y, z)

def place(mesh, pos=(0, 0, 0), rot=(0, 0, 0), axis='y'):
    """Re-aim a part built along +y, rotate it, then move it into joint space."""
    verts, faces = mesh
    out = []
    for (x, y, z) in verts:
        if axis == 'z': x, y, z = x, z, y
        elif axis == 'x': x, y, z = y, x, z
        x, y, z = rot_xyz((x, y, z), rot)
        out.append((x + pos[0], y + pos[1], z + pos[2]))
    return out, faces

def profile(secs):
    """Smooth (Catmull-Rom) interpolation through (y, rx, rz[, cx, cz]) sections."""
    S = [tuple(s) + (0.0,) * (5 - len(s)) for s in sorted(secs)]
    def f(y):
        if y <= S[0][0]: return S[0][1:]
        if y >= S[-1][0]: return S[-1][1:]
        i = max(k for k in range(len(S) - 1) if S[k][0] <= y)
        a, b = S[i], S[i + 1]
        p0 = S[i - 1] if i > 0 else a
        p3 = S[i + 2] if i + 2 < len(S) else b
        t = (y - a[0]) / (b[0] - a[0])
        out = []
        for k in range(1, 5):
            m0 = (b[k] - p0[k]) / max(b[0] - p0[0], 1e-6) * (b[0] - a[0])
            m1 = (p3[k] - a[k]) / max(p3[0] - a[0], 1e-6) * (b[0] - a[0])
            t2, t3 = t * t, t * t * t
            out.append((2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * m1)
        return tuple(out)
    return f, S[0][0], S[-1][0]

def follow(secs, y0, y1, grow, n=8):
    """Sections that hug another part's profile, `grow` units outside it."""
    f, _, _ = profile(secs)
    return [(y, f(y)[0] + grow, f(y)[1] + grow, f(y)[2], f(y)[3]) for y in (y0 + (y1 - y0) * i / n for i in range(n + 1))]

def loft(secs, n=2.6, K=32, steps=20, arc=None, thick=0.07, grooves=(), smooth=True):
    """Skin a superellipse cross-section along y.

    arc=(a0, a1) in degrees (0 = +x, 90 = front) makes an open armor plate with
    real thickness instead of a closed shell. grooves=[(y, depth, width)] cuts
    panel lines.
    """
    f, y0, y1 = profile(secs)
    if smooth:
        ys = {y0 + (y1 - y0) * i / steps for i in range(steps + 1)}
    else:
        ys = {s[0] for s in secs}
    for (gy, gd, gw) in grooves:
        ys |= {gy - gw, gy - gw * 0.45, gy, gy + gw * 0.45, gy + gw}
    ys = sorted(y for y in ys if y0 - 1e-9 <= y <= y1 + 1e-9)
    lin = {s[0]: tuple(s[1:]) + (0.0,) * (5 - len(s)) for s in secs}
    def at(y):
        rx, rz, cx, cz = f(y) if smooth else lin[y]
        k = 1.0
        for (gy, gd, gw) in grooves:
            k -= gd * max(0.0, 1.0 - abs(y - gy) / gw)
        return rx * k, rz * k, cx, cz
    closed = arc is None
    a0, a1 = (0.0, 360.0) if closed else arc
    M = K if closed else K + 1
    angs = [math.radians(a0 + (a1 - a0) * i / K) for i in range(M)]
    verts, faces = [], []
    def ring(y, shrink):
        rx, rz, cx, cz = at(y)
        return [(cx + (rx - shrink) * sgnpow(math.cos(a), n), y, cz + (rz - shrink) * sgnpow(math.sin(a), n)) for a in angs]
    R = len(ys)
    for y in ys: verts += ring(y, 0.0)
    for j in range(R - 1):
        for i in range(M if closed else M - 1):
            a, b = j * M + i, j * M + (i + 1) % M
            faces.append((a, b, b + M, a + M))
    if closed:
        for (j, y) in ((0, ys[0]), (R - 1, ys[-1])):
            rx, rz, cx, cz = at(y)
            c = len(verts); verts.append((cx, y, cz))
            for i in range(M):
                faces.append((c, j * M + i, j * M + (i + 1) % M))
    else:
        o = len(verts)
        for y in ys: verts += ring(y, thick)
        for j in range(R - 1):
            for i in range(M - 1):
                a, b = o + j * M + i, o + j * M + i + 1
                faces.append((a, a + M, b + M, b))
        for j in range(R - 1):                      # the two cut edges
            for i in (0, M - 1):
                a = j * M + i
                faces.append((a, a + M, o + a + M, o + a))
        for j in (0, R - 1):                        # top and bottom lips
            for i in range(M - 1):
                a = j * M + i
                faces.append((a, a + 1, o + a + 1, o + a))
    return verts, faces

def pod(size, n=3.0, n2=2.4, K=28, rings=14):
    """Superellipsoid: the rounded-but-manufactured shape used for armor pods."""
    sx_, sy_, sz_ = size
    verts, faces = [], []
    lat = [(-90 + 180 * i / rings) for i in range(1, rings)]
    for p in lat:
        c, s = math.cos(math.radians(p)), math.sin(math.radians(p))
        r, y = sgnpow(c, n2), sy_ * sgnpow(s, n2)
        for i in range(K):
            a = 2 * math.pi * i / K
            verts.append((sx_ * r * sgnpow(math.cos(a), n), y, sz_ * r * sgnpow(math.sin(a), n)))
    L = len(lat)
    for j in range(L - 1):
        for i in range(K):
            a, b = j * K + i, j * K + (i + 1) % K
            faces.append((a, b, b + K, a + K))
    for (j, y) in ((0, -sy_), (L - 1, sy_)):
        c = len(verts); verts.append((0, y, 0))
        for i in range(K):
            faces.append((c, j * K + i, j * K + (i + 1) % K))
    return verts, faces

def torus(R, r, K=40, k=8, sz=1.0):
    verts, faces = [], []
    for i in range(K):
        a = 2 * math.pi * i / K
        for j in range(k):
            b = 2 * math.pi * j / k
            verts.append(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a) * sz))
    for i in range(K):
        for j in range(k):
            a, b = i * k + j, i * k + (j + 1) % k
            c, d = ((i + 1) % K) * k + (j + 1) % k, ((i + 1) % K) * k + j
            faces.append((a, b, c, d))
    return verts, faces

def cyl(r, h, bevel=0.03, K=28, rz=None):
    rz = rz or r
    hh = h / 2
    return loft([(-hh, r - bevel, rz - bevel), (-hh + bevel, r, rz), (hh - bevel, r, rz), (hh, r - bevel, rz - bevel)], n=2.0, K=K, smooth=False)

# ----------------------------------------------------------------------------- the robot

JOINTS = {  # name: (parent, x, y, z) in arena units — an 8-heads-tall figure, ~10 units
    'hips': (None, 0, 5.3, 0), 'spine': ('hips', 0, 0.3, 0), 'head': ('spine', 0, 2.85, 0),
    'shL': ('spine', 1.55, 2.3, 0), 'elL': ('shL', 0, -1.75, 0), 'shR': ('spine', -1.55, 2.3, 0), 'elR': ('shR', 0, -1.75, 0),
    'hipL': ('hips', 0.6, -0.25, 0), 'knL': ('hipL', 0, -2.45, 0), 'hipR': ('hips', -0.6, -0.25, 0), 'knR': ('hipR', 0, -2.45, 0),
    'disc': ('spine', 0, 1.9, -1.0),
}
ABDO = [(-0.15, 0.56, 0.46), (0.4, 0.48, 0.38), (0.85, 0.56, 0.42)]
CHEST = [(0.75, 0.56, 0.42), (1.1, 0.74, 0.52), (1.6, 1.02, 0.66), (2.1, 1.22, 0.74), (2.5, 1.2, 0.70), (2.75, 0.9, 0.55), (2.9, 0.5, 0.40)]
HELM = {
    'crown':  [(0.25, 0.34, 0.38), (0.5, 0.48, 0.54), (0.9, 0.52, 0.60), (1.25, 0.46, 0.54), (1.5, 0.28, 0.34), (1.6, 0.08, 0.10)],
    'blades': [(0.25, 0.36, 0.40), (0.5, 0.52, 0.56), (0.85, 0.56, 0.62), (1.15, 0.54, 0.60), (1.34, 0.40, 0.46), (1.42, 0.14, 0.16)],
    'staff':  [(0.25, 0.33, 0.37), (0.5, 0.46, 0.52), (0.9, 0.50, 0.60), (1.3, 0.40, 0.50), (1.62, 0.20, 0.26), (1.8, 0.04, 0.05)],
}
UPARM = [(-0.25, 0.32, 0.34), (-0.8, 0.34, 0.36), (-1.5, 0.28, 0.30)]
FOREARM = [(-0.25, 0.32, 0.34), (-0.6, 0.40, 0.42), (-1.1, 0.34, 0.36), (-1.45, 0.26, 0.28)]
THIGH = [(-0.15, 0.46, 0.50), (-0.9, 0.50, 0.54), (-2.2, 0.34, 0.38)]
SHIN = [(-0.3, 0.36, 0.40), (-0.8, 0.42, 0.48), (-1.6, 0.32, 0.36), (-2.25, 0.25, 0.28)]

class Bot:
    def __init__(self):
        self.parts = {}
    def add(self, joint, mat, mesh, pos=(0, 0, 0), rot=(0, 0, 0), axis='y'):
        v, f = place(mesh, pos, rot, axis)
        V, F = self.parts.setdefault((joint, mat), ([], []))
        o = len(V); V += v; F += [tuple(i + o for i in face) for face in f]

def design(kit):
    """Three-tone scheme: black under-suit (shell), gunmetal plates (alloy),
    team-colour identity plates (paint), dark mechanics (frame), light seams (glow)."""
    b = Bot(); A = b.add
    helm_n = {'crown': 2.6, 'blades': 3.6, 'staff': 2.4}[kit]
    helm = HELM[kit]
    # pelvis
    A('hips', 'shell', pod((0.82, 0.5, 0.62), n=2.8), (0, -0.05, 0))
    A('hips', 'alloy', pod((0.34, 0.38, 0.2), n=3.4), (0, -0.2, 0.46))
    A('hips', 'glow', torus(0.63, 0.028, sz=0.78), (0, 0.3, 0))
    for s in (1, -1):
        A('hips', 'frame', pod((0.42, 0.42, 0.42), n=2, n2=2), (0.6 * s, -0.25, 0))
        A('hips', 'alloy', loft([(-0.5, 0.44, 0.52), (0.15, 0.5, 0.6)], n=3.4, arc=(-62, 62) if s > 0 else (118, 242), thick=0.06, grooves=[(-0.2, 0.04, 0.04)]), (0.52 * s, -0.2, 0))
    # waist: ribbed core with three overlapping ab plates
    A('spine', 'frame', loft(ABDO, n=2.4, grooves=[(0.1, 0.09, 0.06), (0.35, 0.09, 0.06), (0.6, 0.09, 0.06)]))
    for (y0, y1) in ((-0.08, 0.2), (0.24, 0.5), (0.54, 0.8)):
        A('spine', 'alloy', loft(follow(ABDO, y0, y1, 0.05, n=3), n=2.8, arc=(42, 138), thick=0.06))
    for y in (0.22, 0.52):
        A('spine', 'glow', torus(0.5, 0.02, sz=0.78), (0, y, 0))
    # torso
    A('spine', 'shell', loft(CHEST, n=3.6))
    for arc in ((20, 86), (94, 160)):
        A('spine', 'paint', loft(follow(CHEST, 1.75, 2.72, 0.05), n=3.6, arc=arc, thick=0.08, grooves=[(2.22, 0.035, 0.035)]))
    A('spine', 'alloy', loft(follow(CHEST, 0.95, 1.66, 0.05), n=3.6, arc=(40, 140), thick=0.07, grooves=[(1.3, 0.035, 0.035)]))
    for arc in ((-28, 14), (166, 208)):
        A('spine', 'alloy', loft(follow(CHEST, 1.15, 2.25, 0.05), n=3.6, arc=arc, thick=0.07, grooves=[(1.7, 0.035, 0.035)]))
    A('spine', 'alloy', loft(follow(CHEST, 1.2, 2.75, 0.06), n=3.6, arc=(206, 334), thick=0.09, grooves=[(1.7, 0.03, 0.035), (2.2, 0.03, 0.035)]))
    A('spine', 'glow', pod((0.035, 0.6, 0.035), n=2), (0, 1.95, -0.83))
    A('spine', 'glow', cyl(0.15, 0.08), (0, 2.02, 0.74), axis='z')
    A('spine', 'frame', torus(0.2, 0.04), (0, 2.02, 0.75), axis='z')
    A('spine', 'frame', torus(0.42, 0.08), (0, 2.9, 0))
    for s in (1, -1):
        A('spine', 'frame', pod((0.38, 0.38, 0.38), n=2, n2=2), (1.5 * s, 2.3, 0))
        A('spine', 'frame', cyl(0.1, 0.4), (0.42 * s, 2.15, -0.86), axis='z')
        A('spine', 'glow', cyl(0.055, 0.42), (0.42 * s, 2.15, -0.86), axis='z')
        A('spine', 'frame', cyl(0.045, 0.7), (0.26 * s, 3.0, -0.12), rot=(0.25, 0, -0.3 * s))   # neck cable
    # head
    A('head', 'frame', loft([(-0.12, 0.3, 0.3), (0.4, 0.25, 0.27)], n=2, grooves=[(0.08, 0.1, 0.045), (0.2, 0.1, 0.045)]))
    A('head', 'shell', loft(helm, n=helm_n))
    vis = {'crown': (0.8, 1.0, 35, 145), 'blades': (0.78, 0.92, 15, 165), 'staff': (0.82, 1.06, 50, 130)}[kit]
    A('head', 'glow', loft(follow(helm, vis[0], vis[1], 0.025, n=4), n=helm_n, arc=(vis[2], vis[3]), thick=0.04))
    A('head', 'alloy', loft(follow(helm, 0.27, vis[0] - 0.06, 0.04, n=5), n=helm_n, arc=(40, 140), thick=0.07, grooves=[(0.5, 0.04, 0.03)]))
    A('head', 'paint', loft(follow(helm, vis[1] + 0.06, helm[-2][0], 0.035, n=5), n=helm_n, arc=(60, 120), thick=0.06))
    for s in (1, -1):
        A('head', 'frame', cyl(0.14, 0.1), (helm[2][1] * s, 0.88, 0), axis='x')
        A('head', 'glow', cyl(0.06, 0.13), (helm[2][1] * s, 0.88, 0), axis='x')
    if kit == 'crown':
        A('head', 'glow', pod((0.02, 0.3, 0.46), n=2.2), (0, 1.42, -0.1))
        for s in (1, -1):
            A('head', 'paint', pod((0.028, 0.22, 0.36), n=2.2), (0.27 * s, 1.36, -0.14), rot=(0, 0, -0.32 * s))
        A('disc', 'shell', cyl(0.8, 0.07, K=48), axis='z')
        A('disc', 'glow', torus(0.86, 0.05), axis='z')
        A('disc', 'glow', torus(0.42, 0.03), (0, 0, -0.03), axis='z')
        A('disc', 'paint', pod((0.16, 0.16, 0.07), n=2), (0, 0, -0.04))
    elif kit == 'blades':
        A('head', 'alloy', pod((0.5, 0.045, 0.56), n=3.6), (0, 1.3, 0))
        A('head', 'glow', torus(0.36, 0.02, sz=1.08), (0, 1.36, 0))
    else:
        A('head', 'glow', pod((0.02, 0.3, 0.02), n=2), (0, 1.98, 0))
    for s in (1, -1):
        # arm
        sh, el = ('shL', 'elL') if s > 0 else ('shR', 'elR')
        out, inn = ((-70, 70), (110, 250)) if s > 0 else ((110, 250), (-70, 70))
        A(sh, 'paint', pod((0.56, 0.4, 0.62), n=3.6, n2=2.8), (0.2 * s, 0.3, 0), rot=(0, 0, -0.25 * s))
        A(sh, 'alloy', loft([(-0.7, 0.44, 0.5), (-0.05, 0.56, 0.62)], n=3.4, arc=out, thick=0.06, grooves=[(-0.4, 0.04, 0.035)]), (0.12 * s, 0, 0))
        A(sh, 'shell', loft(UPARM, n=3))
        A(sh, 'alloy', loft(follow(UPARM, -0.45, -1.22, 0.04), n=3, arc=(28, 152), thick=0.06))
        A(sh, 'frame', cyl(0.06, 1.1), (0, -0.95, -0.36))
        A(sh, 'glow', torus(0.34, 0.022), (0, -0.3, 0))
        A(el, 'frame', cyl(0.28, 0.68), axis='x')
        A(el, 'glow', cyl(0.1, 0.72), axis='x')
        A(el, 'frame', loft([(-0.15, 0.24, 0.24), (-1.52, 0.19, 0.19)], n=2.2, smooth=False))
        A(el, 'paint', loft(FOREARM, n=3, arc=(-140, 140) if s > 0 else (40, 320), thick=0.06, grooves=[(-0.85, 0.04, 0.035), (-1.2, 0.04, 0.035)]))
        A(el, 'glow', torus(0.23, 0.026), (0, -1.54, 0))
        A(el, 'frame', pod((0.2, 0.24, 0.12), n=3), (0, -1.78, 0))
        A(el, 'shell', pod((0.19, 0.2, 0.11), n=3.2), (0, -2.08, 0.07), rot=(-0.4, 0, 0))
        A(el, 'frame', pod((0.07, 0.16, 0.07), n=2.6), (-0.2 * s, -1.9, 0.1), rot=(-0.3, 0, -0.4 * s))
        if kit == 'blades':
            A(el, 'glow', pod((0.028, 0.11, 1.0), n=2, n2=1.6), (0.4 * s, -0.85, 0.62))
            A(el, 'alloy', pod((0.08, 0.18, 0.4), n=3.2), (0.38 * s, -0.85, 0.05))
        # leg
        hp, kn = ('hipL', 'knL') if s > 0 else ('hipR', 'knR')
        A(hp, 'shell', loft(THIGH, n=3))
        A(hp, 'alloy', loft(follow(THIGH, -0.35, -1.55, 0.05), n=3, arc=(24, 156), thick=0.07, grooves=[(-0.75, 0.035, 0.035), (-1.15, 0.035, 0.035)]))
        A(hp, 'paint', loft(follow(THIGH, -0.5, -1.3, 0.05), n=3, arc=(-34, 10) if s > 0 else (170, 214), thick=0.06))
        A(hp, 'frame', cyl(0.055, 1.2), (0, -1.5, -0.42))
        A(kn, 'frame', cyl(0.34, 0.82), axis='x')
        A(kn, 'glow', cyl(0.12, 0.86), axis='x')
        A(kn, 'alloy', pod((0.26, 0.34, 0.18), n=3.4), (0, 0.02, 0.3))
        A(kn, 'frame', loft([(-0.15, 0.28, 0.3), (-2.32, 0.2, 0.22)], n=2.2, smooth=False))
        A(kn, 'paint', loft(SHIN, n=3.2, arc=(-42, 222), thick=0.06, grooves=[(-1.2, 0.04, 0.035), (-1.75, 0.04, 0.035)]))
        A(kn, 'shell', pod((0.32, 0.62, 0.34), n=2.8), (0, -0.85, -0.16))
        A(kn, 'frame', cyl(0.05, 1.0), (0, -1.65, -0.3))
        A(kn, 'glow', pod((0.022, 0.36, 0.02), n=2), (0, -1.45, 0.385), rot=(0.1, 0, 0))
        A(kn, 'glow', torus(0.25, 0.026), (0, -2.33, 0))
        A(kn, 'shell', pod((0.32, 0.17, 0.7), n=3.4, n2=3), (0, -2.43, 0.28))
        A(kn, 'alloy', pod((0.29, 0.13, 0.3), n=3.4), (0, -2.46, 0.72))
        A(kn, 'frame', pod((0.24, 0.16, 0.24), n=3), (0, -2.44, -0.3))
        A(kn, 'alloy', loft([(-2.36, 0.3, 0.34), (-2.12, 0.27, 0.31)], n=3, arc=(30, 150), thick=0.05, smooth=False))
    return b

# ----------------------------------------------------------------------------- blender glue

def to_bl(p):  # arena (x, y, z) -> blender (x, -z, y)
    return (p[0], -p[2], p[1])

def set_inputs(bsdf, **kw):
    names = {'base': 'Base Color', 'metal': 'Metallic', 'rough': 'Roughness', 'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness', 'emit': 'Emission Color', 'emit_k': 'Emission Strength'}
    for k, v in kw.items():
        sock = bsdf.inputs.get(names[k])
        if sock is not None: sock.default_value = v

def material(name, **kw):
    m = bpy.data.materials.new(name); m.use_nodes = True
    set_inputs(m.node_tree.nodes.get('Principled BSDF'), **kw)
    return m

def materials(name, rgb):
    r, g, b_ = rgb
    return {
        'shell': material(name + '_shell', base=(0.012, 0.014, 0.018, 1), metal=0.2, rough=0.5),
        'alloy': material(name + '_alloy', base=(0.11, 0.12, 0.14, 1), metal=1.0, rough=0.38, coat=0.3, coat_rough=0.2),
        'paint': material(name + '_paint', base=(r * 0.62, g * 0.62, b_ * 0.62, 1), metal=0.3, rough=0.34, coat=0.7, coat_rough=0.1),
        'frame': material(name + '_frame', base=(0.05, 0.055, 0.065, 1), metal=1.0, rough=0.3),
        'glow':  material(name + '_glow', base=(0, 0, 0, 1), rough=0.4, emit=(r, g, b_, 1), emit_k=6.0),
    }

def build(name, rgb, kit, coll):
    mats = materials(name, rgb)
    root = bpy.data.objects.new(name, None); coll.objects.link(root)
    joints = {}
    for j, (parent, x, y, z) in JOINTS.items():
        if j == 'disc' and kit != 'crown': continue
        e = bpy.data.objects.new(f'{name}_{j}', None); e.empty_display_size = 0.3; coll.objects.link(e)
        e.parent = joints[parent] if parent else root
        e.location = to_bl((x, y, z)); joints[j] = e
    for (j, mat), (V, F) in design(kit).parts.items():
        me = bpy.data.meshes.new(f'{name}_{j}_{mat}')
        me.from_pydata([to_bl(v) for v in V], [], F); me.update()
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        try: me.set_sharp_from_angle(angle=math.radians(42))
        except Exception: pass
        me.materials.append(mats[mat])
        ob = bpy.data.objects.new(me.name, me); coll.objects.link(ob); ob.parent = joints[j]
    return root, joints

BOTS = [('claude', (1.0, 0.28, 0.02), 'crown'), ('codex', (0.04, 0.3, 1.0), 'blades'), ('gemini', (0.0, 0.85, 0.95), 'staff')]

def stage_and_render(built, path):
    sc = bpy.context.scene
    def pose(j, dx=0.0, dy=0.0, dz=0.0):  # arena-axis rotations
        j.rotation_euler = (dx, -dz, dy)
    for i, (root, J) in enumerate(built):
        root.location = to_bl(((i - 1) * 5.6, 0, 0)); root.rotation_euler = (0, 0, (1 - i) * 0.45)
        pose(J['shL'], 0.12, 0, 0.2); pose(J['shR'], -0.25, 0, -0.2); pose(J['elL'], -0.45); pose(J['elR'], -0.8)
        pose(J['hipL'], -0.1, 0, 0.06); pose(J['hipR'], 0.08, 0, -0.06); pose(J['head'], 0.05, (i - 1) * -0.25)
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-80, -80, 0), (80, -80, 0), (80, 80, 0), (-80, 80, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); sc.collection.objects.link(fo)
    fl.materials.append(material('floor', base=(0.01, 0.012, 0.02, 1), metal=0.9, rough=0.16))
    def light(kind, loc, rgb, watts, size=6):
        d = bpy.data.lights.new('l', kind); d.energy = watts; d.color = rgb
        if kind == 'AREA': d.size = size
        o = bpy.data.objects.new('l', d); sc.collection.objects.link(o); o.location = to_bl(loc)
        t = o.constraints.new('TRACK_TO'); t.target = built[1][0]; t.track_axis = 'TRACK_NEGATIVE_Z'; t.up_axis = 'UP_Y'
        return o
    light('AREA', (-16, 9, -9), (1.0, 0.35, 0.05), 9000, 10)
    light('AREA', (16, 9, -9), (0.1, 0.4, 1.0), 9000, 10)
    light('AREA', (0, 16, -14), (1.0, 0.15, 0.5), 6000, 14)
    light('AREA', (0, 13, 16), (0.75, 0.9, 1.0), 2600, 12)
    light('AREA', (-9, 2, 12), (0.3, 0.9, 1.0), 900, 5)
    w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
    bg = w.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (0.012, 0.006, 0.03, 1); bg.inputs[1].default_value = 1.0
    cam = bpy.data.cameras.new('cam'); cam.lens = 62
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); co.location = to_bl((0, 5.4, 36))
    aim = bpy.data.objects.new('aim', None); sc.collection.objects.link(aim); aim.location = to_bl((0, 5.15, 0))
    t = co.constraints.new('TRACK_TO'); t.target = aim; t.track_axis = 'TRACK_NEGATIVE_Z'; t.up_axis = 'UP_Y'
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.image_settings.file_format = 'PNG'; sc.render.filepath = path
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96; sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU setup skipped:', e)
    try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    bpy.ops.render.render(write_still=True)

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.getcwd()
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    coll = bpy.context.scene.collection
    built = [build(n, rgb, kit, coll) for (n, rgb, kit) in BOTS]
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
    print(f'GLADIATORS built: {len(built)} robots, {tris} triangles')
    glb = os.path.join(out, 'gladiators.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
    print('GLADIATORS exported', glb, os.path.getsize(glb))
    if '--render' in argv:
        stage_and_render(built, os.path.join(out, 'gladiators-render.png'))
        print('GLADIATORS rendered')

main()
