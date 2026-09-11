export async function switchVendorAccount(
  signOut: () => Promise<void>,
  destination: string,
  navigate: (href: string) => void,
) {
  await signOut();
  navigate(`/login?${new URLSearchParams({ redirect: destination })}`);
}
