import type { ConnectorSecretBackend } from '../../packages/connectors/src/index.js';

const unused = async () => {
  throw new Error(
    'Unused secret backend method in unrelated integration fixture.',
  );
};

export const fakeConnectorSecretBackend: ConnectorSecretBackend = {
  createScoped: unused,
  resolveScoped: unused,
  rotateScoped: unused,
  revoke: unused,
  remove: unused,
  health: async () => undefined,
};
