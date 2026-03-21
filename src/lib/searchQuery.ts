const SUBSET_SIZE = 1000;
const PAGE_SIZE = 20;

export function buildTsQuery(skills?: string, designation?: string): string {
  const parts: string[] = [];

  if (skills && skills.trim()) {
    const skillTerms = skills
      .split(/[\s,&|]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (skillTerms.length > 0) {
      parts.push(skillTerms.join(" & "));
    }
  }

  if (designation && designation.trim()) {
    const desigTerms = designation
      .split(/[\s,&|]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (desigTerms.length > 0) {
      parts.push(desigTerms.join(" & "));
    }
  }

  return parts.join(" & ");
}

export function getSubsetOffset(subset: number): number {
  return subset * SUBSET_SIZE;
}

export const SUBSET_SIZE_CONST = SUBSET_SIZE;
export const PAGE_SIZE_CONST = PAGE_SIZE;
