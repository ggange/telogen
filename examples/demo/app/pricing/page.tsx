import { PricingTable } from '../../components/PricingTable';

export const metadata = { title: 'Pricing' };

export async function generateMetadata() {
  return { title: 'Pricing', description: 'Live prices from our catalog API' };
}

export default async function Page() {
  const tiers = await fetch('https://api.acme.example/tiers').then(r => r.json());
  return <PricingTable tiers={tiers} />;
}
