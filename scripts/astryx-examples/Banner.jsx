// Hand-written picture example (V-08): the pinned Banner example shows only a button until clicked.
import {Banner} from '@astryxdesign/core/Banner';
import {VStack} from '@astryxdesign/core/VStack';
export default function BannerShowcase() {
  return (
    <VStack gap={3}>
      <Banner status="success" title="Settings saved" description="Your changes are live for the whole team." isDismissable />
      <Banner status="error" title="Payment failed" description="Update the card on file to keep your plan." />
    </VStack>
  );
}
