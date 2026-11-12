// Hand-written picture example: the pinned EmptyStateShowcase needs @heroicons, which the shot bundle lacks (lucide icon here).
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Search} from 'lucide-react';
export default function EmptyStatePicture() {
  return <EmptyState icon={<Icon icon={Search} size="lg" />} title="No results found" description="Try adjusting your search or filters to find what you need." actions={<Button label="Clear filters" variant="secondary" />} />;
}
