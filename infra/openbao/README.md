# OpenBao bootstrap and operations

Run these steps from an operator workstation over the private TLS endpoint. `BAO_TOKEN` is an operator bootstrap/admin token **on that workstation only**; it must never enter the API, worker, Compose environment, repository, or VDS persistent files. Do not run `bao login` on the VDS because the CLI token helper can persist a token. Keep unseal shares off the VDS and separate from snapshots. Use an off-host operator identity for later administration, then revoke the initial root token.

The first deployment has one Raft node on the ShopAI VDS. `openbao.shopai.internal` is the stable application hostname. TLS CA and server key are operator-provisioned host files. The secret Docker network has no public ingress. Raft data uses a persistent named volume. Collect the declarative, HMAC-protected audit stream from container stdout to restricted off-host storage; `log_raw` stays false. Monitor audit delivery and disk capacity because an unusable audit device can block OpenBao requests.

For **each environment**, initialize and unseal its own OpenBao instance using off-host Shamir shares. The example uses `staging`; repeat with `production` on its separate instance, replacing every environment value. Never use production credentials for staging acceptance.

```sh
export BAO_ADDR=https://openbao.shopai.internal:8200
export BAO_CACERT=/operator/ca.pem
# Set BAO_TOKEN through the operator's secret channel; do not paste it into shell history.
bao status
bao secrets enable -path=shopai-staging -version=2 kv
bao kv put -mount=shopai-staging health ready=true
bao auth enable approle
bao policy write shopai-staging-api infra/openbao/policies/staging-api.hcl
bao policy write shopai-staging-worker infra/openbao/policies/staging-worker.hcl
bao write auth/approle/role/shopai-staging-api token_policies=shopai-staging-api token_no_default_policy=true token_ttl=5m token_max_ttl=5m secret_id_ttl=24h secret_id_num_uses=0
bao write auth/approle/role/shopai-staging-worker token_policies=shopai-staging-worker token_no_default_policy=true token_ttl=5m token_max_ttl=5m secret_id_ttl=24h secret_id_num_uses=0
```

The adapter logs in for every operation, so `secret_id_num_uses=0` avoids exhausting a finite count. Rotate each SecretID before its 24-hour TTL expires; atomic replacement of its host file is read on the next operation. Issue the API and worker SecretIDs independently, preferably with response wrapping from the operator workstation. Deliver unwrapped SecretIDs through separate restricted host files, mounted read-only to only the corresponding container. RoleIDs are separate environment variables. Do not print RoleIDs, SecretIDs, app tokens, or unseal shares in deployment logs. Constrain login CIDRs to the actual private API/worker source ranges after checking Docker network addressing. Rotate RoleIDs/SecretIDs and restart readiness in a controlled window; revoke old SecretID accessors after new identities pass health and operations.

Only the API role may create/read/update `data/connectors/*` and delete `metadata/connectors/*`. The worker role reads `data/connectors/*`. Both read only their mount's exact `data/health` sentinel. No role receives `default`, root, `sys/*`, a cross-environment mount, or a generic `secret/*` grant. The API's metadata delete permanently removes all versions for a revoked or abandoned reference; application DB revocation still runs first. Recheck the policies with real AppRole tokens: API store and revoke succeed; worker read succeeds while write/delete return 403; staging token operations on production mount and vice versa return 403. PostgreSQL plus application code enforce merchant, connection, and provider scope; these environment policies do not isolate one connection from another if an AppRole credential is stolen.

Snapshot recovery: take scheduled `bao operator raft snapshot save` snapshots, encrypt and transfer them off host, and retain them under a separate access policy from Shamir shares. Restore a staging snapshot into an **isolated** Raft volume/service, unseal using the matching off-host shares, and resolve a controlled staging reference. Verify TLS, audit, policy separation, and readiness after restart. Never restore over a running production volume. A single node provides no failover during VDS failure.

Migration on staging is `plan`, `--apply`, `--rollback`, then `--cleanup` dry-run. The final `--cleanup --confirm-retired-file-deletion` is separate, only after 30-day retention and backup review. Production migration is rejected by the script. Keep test credential values out of console output and evidence reports.

References: [OpenBao KV v2 ACL paths](https://openbao.org/docs/secrets/kv/kv-v2/), [AppRole](https://openbao.org/docs/auth/approle/), [declarative audit](https://openbao.org/docs/configuration/audit/), [Raft snapshot](https://openbao.org/docs/commands/operator/raft/).
