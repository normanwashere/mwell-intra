export interface ContextualFeatureGuide {
  id: string;
  title: string;
  routes: string[];
}

const normalizePath = (value: string) => {
  const path = value.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
};

const routeMatches = (pattern: string, pathname: string) => {
  const expected = normalizePath(pattern).split("/").filter(Boolean);
  const actual = normalizePath(pathname).split("/").filter(Boolean);
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) => segment.startsWith(":") || segment === actual[index],
  );
};

export function featureGuideForPathname(
  features: ContextualFeatureGuide[],
  pathname: string,
) {
  return features
    .flatMap((feature) =>
      feature.routes.map((route) => ({ feature, route })),
    )
    .filter(({ route }) => routeMatches(route, pathname))
    .sort(
      (left, right) =>
        right.route
          .split("/")
          .filter((segment) => segment && !segment.startsWith(":")).length -
          left.route
            .split("/")
            .filter((segment) => segment && !segment.startsWith(":")).length ||
        right.route.length - left.route.length,
    )[0]?.feature;
}
