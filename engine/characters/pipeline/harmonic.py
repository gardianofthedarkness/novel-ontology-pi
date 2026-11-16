"""Harmonic weights on a triangle mesh: the smoothest field that is fixed on some points and free elsewhere (the Laplace
equation with the cotangent Laplacian, which does not depend on how the surface was triangulated). Used for skin weights:
fix where a bone surely owns the skin (1) and where it surely does not (0); the blend between is solved, not set.
Pure numpy (Blender's Python has no scipy); conjugate gradients on the free points.

  w = harmonic(V, T, fixed_idx, fixed_val)      V: points (N x 3), T: triangles (M x 3)"""
import numpy as np
TOL = np.finfo(float).eps ** 0.5      # NUMERIC: relative residual at which the solve stops

def cotan_weights(V, T):
    """the cotangent weight of each edge (i, j): half the sum of the cotangents of the angles facing it; negative weights
    (obtuse triangles) are kept at their magnitude so the system stays positive definite"""
    I, J, W = [], [], []
    for a, b, c in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
        u = V[T[:, a]] - V[T[:, c]]; v = V[T[:, b]] - V[T[:, c]]
        cr = np.linalg.norm(np.cross(u, v), axis=1); cot = (u * v).sum(1) / np.maximum(cr, TOL)
        I.append(T[:, a]); J.append(T[:, b]); W.append(np.abs(cot) / 2)
    I, J, W = np.concatenate(I), np.concatenate(J), np.concatenate(W)
    return np.concatenate([I, J]), np.concatenate([J, I]), np.concatenate([W, W])

def harmonic(V, T, fixed_idx, fixed_val):
    V = np.asarray(V, float); T = np.asarray(T, int); n = len(V)
    I, J, W = cotan_weights(V, T)
    deg = np.bincount(I, W, n)
    fixed = np.zeros(n, bool); fixed[fixed_idx] = True; x = np.zeros(n); x[fixed_idx] = fixed_val
    free = ~fixed
    def L(y):   # (D - A) y
        out = deg * y; np.subtract.at(out, I, W * y[J]); return out
    # solve L_ff x_f = -L_fc x_c
    b = -L(np.where(fixed, x, 0.0))[free]
    def Aff(y): z = np.zeros(n); z[free] = y; return L(z)[free]
    xf = np.zeros(free.sum()); r = b - Aff(xf); p = r.copy(); rs = r @ r; b2 = max(b @ b, TOL)
    for _ in range(10 * n):                       # NUMERIC cap; CG converges in at most n steps in exact arithmetic
        if rs <= TOL ** 2 * b2: break
        Ap = Aff(p); a = rs / (p @ Ap); xf += a * p; r -= a * Ap; rn = r @ r; p = r + (rn / rs) * p; rs = rn
    x[free] = xf
    return np.clip(x, 0.0, 1.0)
