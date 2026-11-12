// Hand-written picture example: the pinned TopNavHoverMenu needs @heroicons, which the shot bundle lacks (lucide icons here).
import {TopNav, TopNavHeading, TopNavItem, TopNavMenu} from '@astryxdesign/core/TopNav';
import {BarChart3, ShieldCheck, Zap, Code} from 'lucide-react';
export default function TopNavMenuPicture() {
  return (
    <TopNav label="Main navigation" heading={<TopNavHeading heading="My App" headingHref="#" />} startContent={<>
      <TopNavItem label="Home" href="#" isSelected />
      <TopNavMenu label="Products" items={[
        {title: 'Analytics', description: 'Track and analyze user behavior', icon: <BarChart3 />, href: '#analytics'},
        {title: 'Security', description: 'Enterprise-grade protection', icon: <ShieldCheck />, href: '#security'},
        {title: 'Automation', description: 'Streamline your workflows', icon: <Zap />, href: '#automation'},
        {title: 'Developer Tools', description: 'APIs, SDKs, and CLI tools', icon: <Code />, href: '#dev-tools'},
      ]} />
    </>} />
  );
}
