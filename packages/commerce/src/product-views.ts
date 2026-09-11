import type { Surface, Transport } from '@shopai/contracts';

export type ProductViewEventInput = {
  merchantId: string;
  productId: string;
  searchId: string;
  discoverySessionId?: string;
  transport: Transport;
  surface: Surface;
};

export interface ProductViewEventRepository {
  record(input: ProductViewEventInput): Promise<void>;
}

export class ProductViews {
  constructor(private readonly repository?: ProductViewEventRepository) {}

  async record(input: ProductViewEventInput) {
    await this.repository?.record(input);
  }
}
