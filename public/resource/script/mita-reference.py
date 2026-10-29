"""MiTA learning reference, non-causal attention, s=1.
Run on CUDA, CPU or MPS with Python + PyTorch. Not a performance kernel.
"""
import argparse
import json
import statistics
import time

import torch
import torch.nn.functional as F


def mita(q, k, v, landmarks, topk):
    # q,k,v: [B,H,N,d]; landmarks: [B,H,m,d]
    b, h, n, d = q.shape
    m = landmarks.size(-2)
    assert k.shape == q.shape and v.shape == q.shape
    assert landmarks.shape[:2] == (b, h)
    assert landmarks.size(-1) == d and 1 <= topk <= n
    scale = d ** -0.5

    probe = landmarks @ k.transpose(-2, -1) * scale
    indices = probe.topk(topk, dim=-1).indices   # [B,H,m,k]
    shared_v = probe.softmax(dim=-1) @ v        # [B,H,m,d]

    route_scores = q @ landmarks.transpose(-2, -1) * scale
    route = route_scores.argmax(dim=-1)        # [B,H,N]
    chosen = torch.gather(
        indices, 2, route[..., None].expand(b, h, n, topk)
    )                                         # [B,H,N,k]
    # Each query gets the original KV pairs selected by its landmark.
    gather_idx = chosen[..., None].expand(b, h, n, topk, d)
    routed_k = torch.gather(
        k.unsqueeze(2).expand(b, h, n, n, d), 3, gather_idx
    )
    routed_v = torch.gather(
        v.unsqueeze(2).expand(b, h, n, n, d), 3, gather_idx
    )
    routed_scores = (q.unsqueeze(-2) * routed_k).sum(-1) * scale

    # One softmax over the shared m entries AND the routed k entries.
    scores = torch.cat((route_scores, routed_scores), dim=-1)
    weights = scores.softmax(dim=-1)
    out = weights[..., :m] @ shared_v
    out = out + (weights[..., m:, None] * routed_v).sum(-2)
    return out, (indices, route, shared_v, scores)


def pool_landmarks(q, m):
    # A one-dimensional analogue of the paper's image-grid pooling.
    b, h, n, d = q.shape
    return F.adaptive_avg_pool1d(
        q.reshape(b * h, n, d).transpose(1, 2), m
    ).transpose(1, 2).reshape(b, h, m, d)


def toy(device):
    q = torch.tensor([[2, 0], [2, 1], [1, -1], [3, 0],
                      [0, 2], [1, 2], [-1, 1], [0, 3]],
                     device=device, dtype=torch.float32)[None, None]
    k = torch.tensor([[3, 0], [0, 3], [2, 1], [1, 2],
                      [-2, 0], [0, -2], [1, -1], [-1, 1]],
                     device=device, dtype=torch.float32)[None, None]
    v = torch.tensor([[1, 0], [0, 1], [2, 0], [0, 2],
                      [-1, 0], [0, -1], [1, -1], [-1, 1]],
                     device=device, dtype=torch.float32)[None, None]
    landmarks = q.reshape(1, 1, 2, 4, 2).mean(-2)
    return q, k, v, landmarks


def direct_reference(q, k, v, landmarks, topk):
    # Slow literal concatenation, independently checked with PyTorch SDPA.
    out = torch.empty_like(q)
    scale = q.size(-1) ** -0.5
    for b in range(q.size(0)):
        for h in range(q.size(1)):
            l = landmarks[b, h]
            scores = l @ k[b, h].T * scale
            ids = scores.topk(topk, -1).indices
            sv = F.scaled_dot_product_attention(l, k[b, h], v[b, h])
            for t in range(q.size(-2)):
                x = q[b, h, t:t+1]
                expert = (x @ l.T).argmax().item()
                kk = torch.cat((l, k[b, h, ids[expert]]))
                vv = torch.cat((sv, v[b, h, ids[expert]]))
                out[b, h, t:t+1] = F.scaled_dot_product_attention(x, kk, vv)
    return out


def synchronize(device):
    if device.startswith('cuda'):
        torch.cuda.synchronize(device)
    elif device == 'mps':
        torch.mps.synchronize()


def pick_device():
    if torch.cuda.is_available():
        return {}, 'cuda'
    torch.manual_seed(17)
    torch.set_num_threads(4)
    data = [torch.randn(1, 2, 512, 32) for _ in range(3)]
    timings = {}
    for device in ['cpu'] + (['mps'] if torch.backends.mps.is_available() else []):
        q, k, v = [x.to(device) for x in data]
        l = pool_landmarks(q, 16)
        with torch.no_grad():
            for _ in range(4):
                mita(q, k, v, l, 16)
            synchronize(device)
            samples = []
            for _ in range(9):
                start = time.perf_counter()
                mita(q, k, v, l, 16)
                synchronize(device)
                samples.append((time.perf_counter() - start) * 1000)
        timings[device] = statistics.median(samples)
    return timings, min(timings, key=timings.get)


def verify(device):
    torch.manual_seed(17)
    q, k, v, l = toy(device)
    out, (ids, route, sv, scores) = mita(q, k, v, l, 2)
    assert ids.cpu().tolist() == [[[[0, 2], [1, 3]]]]
    assert route.cpu().tolist() == [[[0, 0, 0, 0, 1, 1, 1, 1]]]
    toy_result = dict(landmarks=l.cpu().tolist(), indices_1based=(ids+1).cpu().tolist(),
                      route_1based=(route+1).cpu().tolist(), shared_v=sv.cpu().tolist(),
                      q1_weights=scores.softmax(-1)[0, 0, 0].cpu().tolist(),
                      q1_output=out[0, 0, 0].cpu().tolist())
    errors = []
    for b, h, n, d, m, topk in [(1, 1, 8, 2, 2, 2), (2, 3, 11, 4, 3, 4),
                               (1, 2, 7, 4, 1, 1), (1, 1, 5, 4, 2, 5),
                               (2, 4, 31, 32, 5, 8)]:
        q, k, v = [torch.randn(b, h, n, d, device=device) for _ in range(3)]
        l = pool_landmarks(q, m)
        actual, (_, _, sv, scores) = mita(q, k, v, l, topk)
        expected = direct_reference(q, k, v, l, topk)
        torch.testing.assert_close(actual, expected, atol=2e-5, rtol=2e-5)
        errors.append((actual - expected).abs().max().item())
        # Joint softmax equals LSE-weighted merging of independently computed branches.
        a, z = scores[..., :m], scores[..., m:]
        oa = a.softmax(-1) @ sv
        # Reconstruct routed-only output from the already validated total.
        idx = (l @ k.transpose(-2, -1)).topk(topk, -1).indices
        routes = (q @ l.transpose(-2, -1)).argmax(-1)
        chosen = idx.gather(2, routes[..., None].expand(b, h, n, topk))
        rv = v.unsqueeze(2).expand(b,h,n,n,d).gather(
            3, chosen[...,None].expand(b,h,n,topk,d))
        oz = (z.softmax(-1)[...,None] * rv).sum(-2)
        mass = torch.stack((a.logsumexp(-1), z.logsumexp(-1)), -1).softmax(-1)
        merged = mass[..., :1] * oa + mass[..., 1:] * oz
        torch.testing.assert_close(actual, merged, atol=2e-5, rtol=2e-5)
        # Raw KV permutation leaves the result unchanged if there are no score ties.
        perm = torch.randperm(n, device=device)
        permuted, _ = mita(q, k[:,:,perm], v[:,:,perm], l, topk)
        torch.testing.assert_close(actual, permuted, atol=2e-5, rtol=2e-5)
    # All queries routed to one expert; empty experts must remain harmless.
    q = torch.ones(2, 2, 7, 4, device=device)
    k, v = [torch.randn_like(q) for _ in range(2)]
    l = torch.stack((torch.ones(4), -torch.ones(4))).to(device)
    l = l[None,None].expand(2,2,2,4)
    actual, (_, route, _, _) = mita(q,k,v,l,3)
    assert (route == 0).all()
    torch.testing.assert_close(actual, direct_reference(q,k,v,l,3), atol=2e-5, rtol=2e-5)
    # Compare continuous-path gradients too; Top-k/argmax indices are discrete.
    q,k,v = [torch.randn(1,2,9,4,device=device,requires_grad=True) for _ in range(3)]
    q_ref,k_ref,v_ref = [x.detach().clone().requires_grad_() for x in [q,k,v]]
    upstream = torch.randn_like(q)
    mita(q,k,v,pool_landmarks(q,3),2)[0].backward(upstream)
    direct_reference(q_ref,k_ref,v_ref,pool_landmarks(q_ref,3),2).backward(upstream)
    gradient_errors = []
    for actual, expected in zip([q,k,v], [q_ref,k_ref,v_ref]):
        assert actual.grad is not None and torch.isfinite(actual.grad).all()
        torch.testing.assert_close(actual.grad, expected.grad, atol=2e-5, rtol=2e-5)
        gradient_errors.append((actual.grad-expected.grad).abs().max().item())
    return dict(toy=toy_result, max_sdpa_error=max(errors),
                max_gradient_error=max(gradient_errors),
                checks=['literal SDPA concatenation', 'joint softmax / LSE merge',
                        'KV permutation', 'multi-batch / multi-head',
                        'k=1 / k=N / m=1', 'uneven pooling', 'empty experts',
                        'backward gradients against SDPA'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', choices=['auto','cuda','cpu','mps'], default='auto')
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    if args.device == 'auto':
        timings, device = pick_device()
    else:
        timings, device = {}, args.device
    report = dict(torch=torch.__version__, device=device, dtype='float32',
                  cuda=torch.version.cuda,
                  gpu=torch.cuda.get_device_name() if device.startswith('cuda') else None,
                  cpu_threads=4,
                  selection_ms=timings, **verify(device))
    print(json.dumps(report, ensure_ascii=False, indent=2))
