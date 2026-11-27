export interface NavigationItem {
  key: string;
}

export interface NavigationGroup {
  items: NavigationItem[];
}

export function getActiveNavigationKey(pathname: string, groups: NavigationGroup[]): string | undefined {
  const sectionPath = pathname === '/inbound-integrations' || pathname.startsWith('/inbound-integrations/')
    ? '/integrations'
    : pathname;
  return groups
    .flatMap((group) => group.items)
    .filter((item) => sectionPath === item.key || sectionPath.startsWith(`${item.key}/`))
    .sort((left, right) => right.key.length - left.key.length)[0]?.key;
}
