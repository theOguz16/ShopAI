path "shopai-staging/data/health" {
  capabilities = ["read"]
}

path "shopai-staging/data/connectors/*" {
  capabilities = ["create", "read", "update"]
}

path "shopai-staging/metadata/connectors/*" {
  capabilities = ["delete"]
}
