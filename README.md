# DO-TAM: Scalable Node.js Web App on DigitalOcean Kubernetes (DOKS)

**Tanmay Rajeev Khurana** — DigitalOcean TAM Assignment

---

## Table of Contents

- [Project Overview](#project-overview)
- [Deployment Flow Diagram](#deployment-flow-diagram)
- [Project Structure](#project-structure)
- [Pre-requisites](#pre-requisites)
- [Step 1: Build and Push Docker Image](#step-1-build-and-push-docker-image)
- [Connect DO Registry to DOKS](#connect-do-registry-to-doks)
- [Step 2: Create a DOKS Cluster](#step-2-create-a-doks-cluster)
- [Step 3: Connect to the Cluster](#step-3-connect-to-the-cluster)
- [Step 4: Create Namespace and Deploy App](#step-4-create-namespace-and-deploy-app)
- [Step 5: Install Metrics Server](#step-5-install-metrics-server)
- [Step 6: Enable HPA](#step-6-enable-hpa)
- [Step 7: Verify the LoadBalancer Service](#step-7-verify-the-loadbalancer-service)
- [Step 8: Load Testing with k6](#step-8-load-testing-with-k6)
- [Cost and Performance Summary](#cost-and-performance-summary)

---

## Project Overview

DO-TAM is a lightweight Node.js web application deployed on DigitalOcean
Kubernetes to demonstrate real cloud-native infrastructure capabilities.

### What This Project Demonstrates

| Capability | Implementation |
|---|---|
| **Scalability** | HPA scales pods from 2 → 5 based on CPU utilisation |
| **High Availability** | Minimum 2 replicas always running behind a Load Balancer |
| **Load Balancing** | Pod hostname exposed on every request — proves traffic is distributed |
| **Self-Healing** | Liveness probes auto-restart unhealthy pods |
| **Zero Downtime** | Rolling update strategy with `maxUnavailable: 0` |
| **Cost Optimisation** | Single s-1vcpu-1gb node keeps baseline at ~$18/month |

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 + Express.js |
| Container Base | node:18-alpine (~130MB image) |
| Orchestration | DigitalOcean Kubernetes (DOKS) |
| Registry | DigitalOcean Container Registry (DOCR) |
| Autoscaling | Kubernetes HPA + Metrics Server |
| Load Testing | k6 |

### API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Serves the HTML dashboard page |
| `GET /health` | Returns `{"status":"healthy"}` — used by K8s probes |

---

## Deployment Flow Diagram

```
Developer
↓
docker build  (node:18-alpine)
↓
docker push   (DigitalOcean Container Registry)
↓
kubectl apply (DOKS Cluster)
↓
Kubernetes Deployment → Pod(s) running Node.js + Express
↓
Horizontal Pod Autoscaler (scales pods based on CPU utilisation)
↓
Kubernetes Service (LoadBalancer)
↓
User accesses via EXTERNAL-IP on port 80
```

---

## Project Structure

```
DO-TAM/
├── Webapp/
│   ├── server.js          ← Express server (routes, health endpoint)
│   ├── package.json       ← Node.js dependencies and start script
│   ├── index.html         ← Frontend HTML page
│   └── Dockerfile         ← node:18-alpine multi-layer container spec
├── K8s/
│   ├── deployment.yaml    ← 2 replicas, resource limits, liveness + readiness probes
│   ├── service.yaml       ← LoadBalancer service, port 80 → 3000
│   └── app-hpa.yaml       ← HPA: min 2 / max 5 pods, triggers at 50% CPU
├── loadtest.js            ← k6 load test: 200 VUs for 5 minutes
└── README.md
```

---

## Pre-requisites

Before deploying the web application, ensure you have:

- A **DigitalOcean account** with billing set up
- **Docker** installed and running — [docs.docker.com/get-docker](https://docs.docker.com/get-docker/)
- **doctl** (DigitalOcean CLI) installed and authenticated — [docs.digitalocean.com/reference/doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/)
- **kubectl** installed — [kubernetes.io/docs/tasks/tools](https://kubernetes.io/docs/tasks/tools/)
- **k6** installed — [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/)
- A **DigitalOcean Container Registry** (DOCR) created
- A **GitHub repository** containing the application code

---

## Step 1: Build and Push Docker Image

Navigate into the Webapp folder and run the following commands:

```bash
cd Webapp

# Authenticate doctl with your DigitalOcean account
doctl auth init

# Log Docker into DOCR
doctl registry login

# Build the Docker image
docker build -t myapp .

# Tag the image for your DOCR registry
docker tag myapp registry.digitalocean.com/<your-registry-name>/myapp:1.0

# Push the image to DOCR
docker push registry.digitalocean.com/<your-registry-name>/myapp:1.0
```

After pushing, open `K8s/deployment.yaml` and update the image line:

```yaml
image: registry.digitalocean.com/<your-registry-name>/myapp:1.0
```

---

## Connect DO Registry to DOKS

Your cluster needs permission to pull images from your private registry.

### Via Console

1. Go to [cloud.digitalocean.com/registry](https://cloud.digitalocean.com/registry)
2. Click the **Settings** tab
3. Under **Kubernetes Integration**, click **Edit**
4. Select your DOKS cluster
5. Click **Save**

This automatically creates a Kubernetes Secret containing registry credentials
and patches all service accounts in the cluster — no manual `imagePullSecrets`
configuration needed.

### Via CLI

```bash
doctl registry kubernetes-manifest | kubectl apply -f -
```

> **Note:** Only Kubernetes 1.19+ is supported for registry integration.

---

## Step 2: Create a DOKS Cluster

### Option A: Using doctl

```bash
doctl kubernetes cluster create do-tam-cluster \
  --region blr1 \
  --version 1.33.1-do.1 \
  --count 1 \
  --size s-1vcpu-1gb \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 2
```

> Region options: `blr1` = Bangalore · `sgp1` = Singapore · `nyc3` = New York · `fra1` = Frankfurt

### Option B: Using DigitalOcean Console

1. Go to [cloud.digitalocean.com/kubernetes](https://cloud.digitalocean.com/kubernetes)
2. Click **Create Kubernetes Cluster**
3. Configure the following:
   - **Region:** Closest to your users
   - **Version:** Latest stable
   - **Node Pool Size:** s-1vcpu-1gb
   - **Autoscaling:** Enabled — Min 1 / Max 2 nodes
4. Click **Create Cluster** and wait ~4 minutes for provisioning

---

## Step 3: Connect to the Cluster

```bash
# Save cluster credentials to your local kubeconfig
doctl kubernetes cluster kubeconfig save do-tam-cluster

# Verify kubectl is connected
kubectl get nodes
```

**Expected output:**

```
NAME                   STATUS   ROLES    AGE   VERSION
default-pool-xxxxx     Ready    <none>   2m    v1.33.1
```

---

## Step 4: Create Namespace and Deploy App

```bash
# Return to project root
cd ..

# Create the webapp namespace
kubectl create ns webapp

# Deploy the application
kubectl apply -f K8s/deployment.yaml

# Create the LoadBalancer service
kubectl apply -f K8s/service.yaml

# Verify pods are starting
kubectl get pods -n webapp
```

**Expected output:**

```
NAME                               READY   STATUS    RESTARTS   AGE
tech-intro-page-75f7769968-abc12   1/1     Running   0          1m
tech-intro-page-75f7769968-def34   1/1     Running   0          1m
```

---

## Step 5: Install Metrics Server

The Metrics Server is required for HPA to read CPU usage from pods.
Without it, `kubectl get hpa` shows `<unknown>` and autoscaling never triggers.

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

Wait ~30 seconds, then verify:

```bash
kubectl get deployment metrics-server -n kube-system
```

**Expected output:**

```
NAME             READY   UP-TO-DATE   AVAILABLE
metrics-server   1/1     1            1
```

---

## Step 6: Enable HPA

```bash
kubectl apply -f K8s/app-hpa.yaml

# Verify HPA is active
kubectl get hpa -n webapp
```

**Expected output:**

```
NAME              REFERENCE                    TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
tech-intro-page   Deployment/tech-intro-page   cpu: 1%/50%   2         5         2          1m
```

The HPA immediately enforces `minReplicas: 2` — if only 1 pod was running
from the deployment, a second one starts automatically at this point.

---

## Step 7: Verify the LoadBalancer Service

DigitalOcean takes 60–90 seconds to provision the Load Balancer after
the service is applied. Watch for the EXTERNAL-IP to appear:

```bash
kubectl get svc -n webapp -w
```

**Expected output:**

```
NAME                 TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)        AGE
tech-intro-service   LoadBalancer   10.108.41.220   <pending>        80:30856/TCP   10s
tech-intro-service   LoadBalancer   10.108.41.220   159.89.254.19    80:30856/TCP   78s
```

Press `Ctrl+C` once the IP appears. Open `http://<EXTERNAL-IP>` in your browser.
Your app is live on Kubernetes.

---

## Full Expected Output

```bash
$ kubectl get pods -n webapp
NAME                               READY   STATUS    RESTARTS   AGE
tech-intro-page-75f7769968-abc12   1/1     Running   0          5m
tech-intro-page-75f7769968-def34   1/1     Running   0          5m

$ kubectl get hpa -n webapp
NAME              REFERENCE                    TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
tech-intro-page   Deployment/tech-intro-page   cpu: 0%/50%   2         5         2          5m

$ kubectl get svc -n webapp
NAME                 TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)        AGE
tech-intro-service   LoadBalancer   10.108.41.220   159.89.254.19    80:30856/TCP   5m
```

---

## Step 8: Load Testing with k6

### Install k6

```bash
# macOS
brew install k6

# Windows
winget install k6

# Linux (Debian/Ubuntu)
sudo apt-get install k6
```

### Configure the Load Test

Open `loadtest.js` in the project root and replace the IP placeholder:

```javascript
const BASE_URL = 'http://<YOUR-EXTERNAL-IP>';
```

Replace `<YOUR-EXTERNAL-IP>` with the IP from Step 7.

### Run the Load Test

Open two terminal windows side by side.

**Terminal 1 — watch HPA react in real time:**

```bash
kubectl get hpa -n webapp -w
```

**Terminal 2 — run the load test:**

```bash
k6 run loadtest.js
```

### Expected k6 Output

```
✓ status is 200
✓ response time < 2s

checks.........................: 100%
http_req_duration..............: avg=239ms  min=12ms   med=198ms  max=1.49s
http_reqs......................: 48440  ~160/s
http_req_failed................: 0.00%
vus............................: 200
duration.......................: 5m0s
```

### Expected HPA Behaviour During Load Test

```
NAME              TARGETS        MINPODS   MAXPODS   REPLICAS
tech-intro-page   cpu: 2%/50%    2         5         2         ← idle
tech-intro-page   cpu: 78%/50%   2         5         2         ← load hits
tech-intro-page   cpu: 78%/50%   2         5         4         ← scaling up
tech-intro-page   cpu: 45%/50%   2         5         5         ← max replicas
tech-intro-page   cpu: 4%/50%    2         5         2         ← cooldown, scales down
```

---

## Cost and Performance Summary

| Item | Status | Notes |
|---|---|---|
| DOKS Control Plane | **Free** | Fully managed by DigitalOcean |
| Worker Node | s-1vcpu-1gb | ~$6/month |
| DO Load Balancer | lb-small | ~$12/month |
| Container Registry | **Free** | Starter tier — 500MB included |
| HPA | Enabled | Scales 2 → 5 pods at 50% CPU threshold |
| Resource Requests | 100m CPU / 128Mi RAM | Per pod — used by HPA for % calculation |
| Resource Limits | 200m CPU / 256Mi RAM | Hard ceiling per pod |
| Health Probes | Enabled | Liveness + readiness on `/health` endpoint |
| **Estimated Baseline** | | **~$18/month** |
| CDN + DO Spaces | Suggested | Would reduce serving cost to ~$5/month |

---

## Teardown

To stop all billing immediately after your demo:

```bash
# Delete the cluster (also removes the Load Balancer)
doctl kubernetes cluster delete do-tam-cluster

# Delete the container registry
doctl registry delete <your-registry-name>
```

---

## Future Improvements

| Improvement | Benefit |
|---|---|
| CI/CD with GitHub Actions | Auto-build and deploy on every `git push` |
| HTTPS via cert-manager | Free TLS certificates from Let's Encrypt |
| DO Spaces + CDN | Serve static assets globally, reduce backend load |
| Prometheus + Grafana | Real-time metrics dashboards for the cluster |
| Redis (DO Managed) | Shared caching layer across pods |
| RBAC | Role-based access control for cluster security |
| High Availability Control Plane | Multi-node control plane (~$40/month add-on) |
| DO Managed PostgreSQL | Persistent database for stateful workloads |
