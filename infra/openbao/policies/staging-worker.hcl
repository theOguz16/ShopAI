path "shopai-staging/data/health" {
  capabilities = ["read"]
}

path "shopai-staging/data/connectors/*" {
  capabilities = ["read"]
}
