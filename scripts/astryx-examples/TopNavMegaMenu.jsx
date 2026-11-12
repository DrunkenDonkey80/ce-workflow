// Hand-written picture example: the pinned TopNavMegaMenuBasic needs @heroicons, which the shot bundle lacks (lucide icons here).
import {TopNav, TopNavHeading, TopNavItem, TopNavMegaMenu, TopNavMegaMenuItem} from '@astryxdesign/core/TopNav';
import {Rocket, BookOpen} from 'lucide-react';
export default function TopNavMegaMenuPicture() {
  return (
    <TopNav style={{width: 600}} label="Main navigation" heading={<TopNavHeading heading="DevTools" />} startContent={<>
      <TopNavItem label="Overview" href="#" isSelected />
      <TopNavMegaMenu label="Products" items={<>
        <TopNavMegaMenuItem title="Deploy" description="Ship to production in seconds" icon={<Rocket width={20} height={20} />} href="#deploy" />
        <TopNavMegaMenuItem title="Documentation" description="Guides, references, and tutorials" icon={<BookOpen width={20} height={20} />} href="#docs" />
      </>} />
    </>} />
  );
}
