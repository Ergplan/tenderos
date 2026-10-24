# Deploying a demo VM

One VM runs everything with Docker Compose:

* Postgres;
* the engine;
* the web app;
* Caddy, which serves HTTPS on ports 80 and 443 with a Let's Encrypt certificate.

Only Caddy is reachable from outside.

## 1. Create the VM (Google Cloud)

Run this in Cloud Shell, in a clone of this repository:

```
PROJECT=<gcp-project-id> ADMIN_EMAIL=<your-login> bash deploy/gcp-create-vm.sh
```

The script does the following:

* It reserves a static IP and creates three firewall rules:
  * port 80, open to all, so Let's Encrypt can issue the certificate;
  * port 443, open to `WEB_SOURCES` (default: everyone; the app needs a login);
  * port 22, open only to Google's IAP range.
* It creates an `e2-standard-4` VM: 4 vCPU, 16 GB, Ubuntu 24.04, a 50 GB disk, in Mumbai
  (`asia-south1-a`). Sizing a tender on this VM takes about a minute.
* It runs `deploy/bootstrap.sh` on the VM.

At the end, the script prints the URL, the login and a generated password. The password is
also kept on the VM in `/root/tenderos-admin.txt`.

Options (environment variables):

| Variable | Default | |
| --- | --- | --- |
| `ZONE` | `asia-south1-a` | |
| `MACHINE` | `e2-standard-4` | |
| `WEB_SOURCES` | `0.0.0.0/0` | Comma-separated CIDRs allowed on 443, such as the client's office IPs |
| `SITE_ADDRESS` | `<ip>.sslip.io` | Your domain; point its A record at the static IP first |
| `ANTHROPIC_API_KEY` | (unset) | Model reading of tenders (see 4) |
| `BRANCH` | `main` | |

The script creates the VM only. On any other cloud, or on an existing Ubuntu/Debian VM, open
ports 80 and 443 and run the following on the VM:

```
curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/bootstrap.sh -o bootstrap.sh
sudo ADMIN_EMAIL=<your-login> bash bootstrap.sh
```

## 2. What the bootstrap does

1. Installs Docker and clones the repository to `/opt/tenderos`.
2. Writes `/opt/tenderos/.env` (mode 600): random database password and session secret, the
   site address, and the API key if one was given. It keeps an existing `.env`.
3. Builds and starts the database, the engine and the web app, with nothing exposed yet.
4. Creates the administrator with a generated password. Nobody else can claim the first-run
   setup page.
5. Starts Caddy, which fetches the certificate and opens the site.

Running the bootstrap again is safe. It keeps the `.env`, the database and the administrator.

## 3. Operating it

| Task | Command (on the VM) |
| --- | --- |
| Update to the latest code, after a database backup | `sudo bash /opt/tenderos/deploy/update.sh` |
| Back up the database (the newest 14 are kept in `backups/`) | `sudo bash /opt/tenderos/deploy/backup.sh` |
| Restore | the steps at the top of `deploy/backup.sh` |
| Logs | `cd /opt/tenderos && sudo docker compose logs -f web engine caddy` |
| Status | `cd /opt/tenderos && sudo docker compose ps` |

To add client users, sign in as the administrator and open **Users**. Give each user only the
tabs they should see, for example Tender to Bid.

## 4. Model reading

Without `ANTHROPIC_API_KEY`, tenders are read by the rules reader. It finds the headline fields,
about 31 on the NHPC RfS, each with its page and quote. That is enough for the Tender to Bid
flow.

To enable model reading:

1. Put the key in `/opt/tenderos/.env`.
2. Run `deploy/update.sh`.

The model path has not yet been run against a real tender. Before a client sees it, read the
NHPC RfS once and compare the result with `samples/tenders/nhpc-fdre-ii/reviewed-reading.yaml`.

## 5. Demo run

1. Sign in.
2. On **Tender to Bid**, open "Read a new tender" and upload
   `samples/tenders/nhpc-fdre-ii/RfS.pdf` (264 pages; read in about 5 s).
3. Go through the steps, choosing solar, wind and battery and filling in the benchmarks.
4. Click **Size the plant**. It takes about a minute.
5. Review the tender conditions, open Financials and download the Excel model.

`docs/E2E-NHPC.md` lists the expected numbers.

To check a deployed site from any machine with the repository:

```
TENDEROS_URL=https://<site> TENDEROS_EMAIL=… TENDEROS_PASSWORD=… make e2e
```

## 6. Beside the old app on the shared VM (port 8081)

On the tariff-order VM (34.131.67.235), the old jouleWise app (compose project `fdre-dashboard`)
was published on port 8081. Ports 80 and 443 belong to the tariff-order app's Caddy and are
not touched. `deploy/shared-vm/install.sh` puts TenderOS beside the old app:

* `http://34.131.67.235:8081/` shows a chooser: **TenderOS** (new design and workflow, no
  sign-in) or the **old app** (unchanged, existing accounts).
  * The choice is a cookie, so the address stays the same and both apps keep their root paths.
  * "Switch app" in the TenderOS sidebar, or `/__switch`, shows the chooser again.
* TenderOS runs in demo mode (`DEMO_MODE=1`). Every visitor is signed in as one shared demo user
  who can open every tab.
  * Sign-in, first-run setup, account changes and administration are switched off.
  * Saved scenarios are shared by everyone who opens the demo.
* The old app's web container moves from `0.0.0.0:8081` to `127.0.0.1:8082`, and the router
  reaches it over its compose network. Its database, engine and data are not touched. The
  move costs about 10 seconds of downtime.
  * If the old app's own `deploy/update.sh` runs later, it re-publishes on port 8082. The
    router still finds it by container name.
* Measured memory use is about 0.5 GB for TenderOS while sizing NHPC; the build needs about 2 GB.
* The SECI RTC tab's voice bid agent (GPT-Live) needs `OPENAI_API_KEY` in TenderOS's `.env`.
  * Add the key there, then re-run the install to restart the web service.
  * The key stays on the server.
  * Without the key, the agent's panel says it is not set up.
* Browsers allow the microphone only on HTTPS or localhost, and the 8081 address is plain HTTP.
  To talk to the agent there, open an SSH tunnel and browse to `http://localhost:8081`:
  `gcloud compute ssh <vm> -- -L 8081:localhost:8081`.

```
curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/shared-vm/install.sh -o install.sh
sudo bash install.sh                                 # BRANCH=... for another branch
sudo bash /opt/tenderos/deploy/shared-vm/rollback.sh  # undo: old app back on 8081
```

Tested here against a stand-in for the old app: a compose project `fdre-dashboard` with a
`${WEB_PORT}:3000` web service and a Postgres db. The tests covered:

* the install and the move of the old app to `127.0.0.1:8082`;
* the chooser, both switches and `/__switch`;
* the NHPC browser run through the chooser with no sign-in;
* setup, account and admin closed;
* the rollback to 8081 and a re-install.

The real old app has not been run behind the router here.

## 7. Removing it

Delete the VM, the static IP and the firewall rules:

```
gcloud compute instances delete tenderos-demo --zone asia-south1-a
gcloud compute addresses delete tenderos-demo-ip --region asia-south1
gcloud compute firewall-rules delete tenderos-demo-http tenderos-demo-https tenderos-demo-ssh
```

## Tested

The bootstrap was run end to end on a Docker host with `SITE_ADDRESS=localhost`, where Caddy
issues its own certificate. Docker and the images were already present (`SKIP_INSTALL=1
NO_BUILD=1`). What was checked:

* HTTPS and the HTTP→HTTPS redirect;
* a secure, HttpOnly session cookie and HSTS;
* the web port closed to the outside, and `/setup` locked once the admin exists;
* the browser end-to-end test through Caddy, from upload to the Excel model;
* a second run that keeps `.env` and the admin;
* a backup, and a restore of it.

Not yet run:

* `gcp-create-vm.sh` on a real project;
* a real Let's Encrypt issuance;
* the Docker install step on a fresh Ubuntu VM.
