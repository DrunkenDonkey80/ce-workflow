// Hand-written picture example (V-08): the pinned Badge has no example.
import {Badge} from '@astryxdesign/core/Badge';
import {HStack} from '@astryxdesign/core/HStack';
export default function BadgeShowcase() {
  return (
    <HStack gap={2} wrap="wrap">
      <Badge label="Active" variant="success" />
      <Badge label="Degraded" variant="warning" />
      <Badge label="Failed" variant="error" />
      <Badge label="Engineering" variant="blue" />
      <Badge label="Design" variant="purple" />
      <Badge label="Draft" />
    </HStack>
  );
}
