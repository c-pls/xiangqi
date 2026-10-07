# Xiangqi (Chinese Chess) Deployment Guide

This guide covers building, pushing, deploying, verifying, monitoring, and scaling the Chinese Chess (Xiangqi) multiplayer application on Kubernetes.

---

## 1. Quick Prerequisites

- Docker or containerd CLI installed.
- Access to a Kubernetes cluster (v1.22+) with `kubectl` configured.
- Ingress-NGINX controller installed (with WebSocket support enabled).
- Optional: cert-manager for automatic TLS certificate management.

---

## 2. Docker Image Build & Push

Set your target container registry and image tag:

```bash
export REGISTRY="registry.internal.mycompany.com"
export IMAGE_TAG="v1.0.0"
export IMAGE="${REGISTRY}/xiangqi:${IMAGE_TAG}"

# Build the multi-stage image
docker build -t ${IMAGE} -t ${REGISTRY}/xiangqi:latest .

# Push to your enterprise registry
docker push ${IMAGE}
docker push ${REGISTRY}/xiangqi:latest
```

---

## 3. Deploying to Kubernetes

### Step 3.1: Update Image in Deployment (if using a custom tag)
If using a custom registry or tag, update `k8s/deployment.yaml` or use `kubectl set image`:

```bash
sed -i.bak "s|image: xiangqi:latest|image: ${IMAGE}|g" k8s/deployment.yaml
```

### Step 3.2: Apply Manifests
Deploy the ConfigMap, Service, Deployment, and Ingress:

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

Check the rollout status:
```bash
kubectl rollout status deployment/xiangqi
```

---

## 4. Verification & Diagnostics

### 4.1 Check Pod Status
```bash
kubectl get pods -l app=xiangqi
```

### 4.2 Health & Probes
Verify the HTTP `/healthz` probe directly or via port-forwarding:
```bash
# Port-forward for local verification
kubectl port-forward svc/xiangqi-service 8080:80

# Check health endpoint
curl -i http://localhost:8080/healthz
# Response: {"status":"ok","uptime":...}
```

### 4.3 Prometheus Metrics
Inspect live metrics (active users, active rooms, moves processed, error counts):
```bash
curl -i http://localhost:8080/metrics
```
Metrics exposed include:
- `xiangqi_connected_users`: Current number of connected WebSocket clients.
- `xiangqi_active_rooms`: Number of active rooms.
- `xiangqi_moves_total`: Cumulative counter of valid moves applied.
- `xiangqi_errors_total`: Cumulative counter of client errors and rejections.

### 4.4 View Logs
Stream application logs:
```bash
kubectl logs -f -l app=xiangqi --tail=100
```

---

## 5. Rollback Procedures

If a deployment fails health checks or introduces issues, immediately roll back to the previous revision:

```bash
# Check deployment rollout history
kubectl rollout history deployment/xiangqi

# Rollback to the previous deployment revision
kubectl rollout undo deployment/xiangqi

# Wait for the rollback to stabilize
kubectl rollout status deployment/xiangqi
```

---

## 6. Zero-Downtime & Graceful Restart (preStop Hook)

The deployment specifies:
- `terminationGracePeriodSeconds: 40`
- A `preStop` HTTP hook calling `/pre-stop`:
  When Kubernetes issues a termination request (e.g. during rollout or node draining), the `/pre-stop` endpoint automatically sends a `SERVER_RESTART` notification over active WebSocket connections and cleanly closes connections (code `1012 Service Restart`).
- The client receives this notification and seamlessly activates its exponential-backoff auto-reconnect overlay without showing an unexpected crash error.

---

## 7. Scaling Beyond 1 Replica (Multi-Node Scaling Guide)

The current implementation runs as a **single replica (`replicas: 1`)** using an in-memory `IRoomStorage` (`MemoryRoomStorage`). A single Node.js instance comfortably supports hundreds of concurrent rooms and tens of thousands of moves per minute.

To scale horizontally across multiple Kubernetes pods or nodes, implement the following standard pattern:

### 7.1 Redis-Backed Storage (`IRoomStorage`)
The codebase cleanly abstracts state management behind `server/src/storage/interface.js` (`IRoomStorage`). 
To scale across multiple replicas:
1. Implement `RedisRoomStorage` adhering to `IRoomStorage`:
   - Store room state as JSON strings or Redis Hashes: `room:{roomId}`.
   - Store code lookup indices in Redis Hashes: `room_codes -> {code: roomId}`.
   - Store active user room lookups: `user_rooms -> {userId: roomId}`.
2. In `server/src/rooms/room-manager.js`, inject `RedisRoomStorage` instead of `MemoryRoomStorage`.

### 7.2 Cross-Pod Message Broadcasting (Redis Pub/Sub)
When two players in the same room are connected to different Kubernetes pods:
- Use Redis Pub/Sub with channels keyed by `room:{roomId}`.
- When Pod A applies a move from Player Red, it publishes the `moveApplied` payload to `room:{roomId}`.
- Pod B, which holds Player Black's WebSocket connection, subscribes to `room:{roomId}` and forwards the message to Black's socket.

### 7.3 Ingress Session Affinity (Sticky Sessions)
Alternatively, or in conjunction with Redis Pub/Sub, enable sticky sessions on the Ingress so that WebSocket clients from the same IP/cookie stick to the same pod when possible:
```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "xiangqi-route"
    nginx.ingress.kubernetes.io/session-cookie-hash: "sha1"
```

### 7.4 Distributed Lock for Move Synchronization
To prevent race conditions on concurrent move requests in a multi-pod setup, use a distributed Redis lock (e.g., Redlock) on the `roomId` when validating and applying moves.

---

## 8. CI: GitHub Actions → Quay.io

`.github/workflows/docker-publish.yml` runs on every push to `main`, on `v*.*.*` tags, and manually. It runs the client + server test suites first, then builds the **linux/amd64** image with Buildx and pushes it to Quay.io (`:latest` on main, `:sha-*` always, semver tags on releases).

One-time setup:
1. In `.github/workflows/docker-publish.yml`, set `IMAGE_NAME` to `quay.io/<your-namespace>/antigravity`.
2. In Quay.io, create the `antigravity` repository (if it doesn't exist) and a robot account with **Write** permission on it.
3. In GitHub repo Settings → Secrets and variables → Actions, add:
   - `QUAY_USERNAME` — robot account name (e.g. `myuser+github`)
   - `QUAY_PASSWORD` — robot account token
