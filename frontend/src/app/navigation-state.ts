export interface NavigationItem {
  key: string;
}

export interface NavigationGroup {
  items: NavigationItem[];
}

export function getActiveNavigationKey(pathname: string, groups: NavigationGroup[]): string | undefined {
  return groups
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
    .sort((left, right) => right.key.length - left.key.length)[0]?.key;
}
