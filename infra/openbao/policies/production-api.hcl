path "shopai-production/data/health" {
  capabilities = ["read"]
}

path "shopai-production/data/connectors/*" {
  capabilities = ["create", "read", "update"]
}

path "shopai-production/metadata/connectors/*" {
  capabilities = ["delete"]
}
