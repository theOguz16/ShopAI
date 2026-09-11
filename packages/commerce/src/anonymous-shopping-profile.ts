import type {
  AnonymousShoppingProfile,
  AnonymousShoppingProfileUpdate,
} from '@shopai/contracts/anonymous-shopping-profile';

export interface AnonymousShoppingProfileRepository {
  getOrCreate(anonymousUserId: string): Promise<AnonymousShoppingProfile>;
  replace(profile: AnonymousShoppingProfile): Promise<AnonymousShoppingProfile>;
}

export class AnonymousShoppingProfiles {
  constructor(
    private readonly repository: AnonymousShoppingProfileRepository,
  ) {}

  getOrCreate(anonymousUserId: string) {
    return this.repository.getOrCreate(anonymousUserId);
  }

  async update(anonymousUserId: string, input: AnonymousShoppingProfileUpdate) {
    const current = await this.repository.getOrCreate(anonymousUserId);
    const category = input.category;
    const next: AnonymousShoppingProfile = {
      ...current,
      preferredSizes:
        input.preferredSizes === undefined
          ? current.preferredSizes
          : { ...current.preferredSizes, [category]: input.preferredSizes },
      preferredColors:
        input.preferredColors === undefined
          ? current.preferredColors
          : { ...current.preferredColors, [category]: input.preferredColors },
      preferredStyles:
        input.preferredStyles === undefined
          ? current.preferredStyles
          : { ...current.preferredStyles, [category]: input.preferredStyles },
      preferredPriceRanges: this.nextPriceRanges(
        current.preferredPriceRanges,
        category,
        input,
      ),
      updatedAt: new Date().toISOString(),
    };
    return this.repository.replace(next);
  }

  private nextPriceRanges(
    current: AnonymousShoppingProfile['preferredPriceRanges'],
    category: string,
    input: AnonymousShoppingProfileUpdate,
  ) {
    if (input.preferredPriceRange === undefined) return current;
    if (input.preferredPriceRange === null) {
      const { [category]: _removed, ...rest } = current;
      return rest;
    }
    return { ...current, [category]: input.preferredPriceRange };
  }
}
