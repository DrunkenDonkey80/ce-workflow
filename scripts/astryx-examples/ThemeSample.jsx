// Theme picture, not a component: astryx-component-shots.mjs renders this one screen once per pinned theme.
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {TextInput} from '@astryxdesign/core/TextInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Switch} from '@astryxdesign/core/Switch';
import {Button} from '@astryxdesign/core/Button';
const none = () => {};
export default function ThemeSample() {
  return (
    <Card padding={5} elevation="low">
      <VStack gap={4}>
        <HStack gap={3}>
          <Avatar name="Ada Lovelace" size="md" />
          <VStack gap={0.5}>
            <Heading level={2}>Weekly report</Heading>
            <Text type="supporting" color="secondary">Updated 5 minutes ago</Text>
          </VStack>
        </HStack>
        <HStack gap={2}>
          <Badge variant="success" label="On track" />
          <Badge variant="warning" label="2 reviews" />
          <Badge variant="info" label="Beta" />
        </HStack>
        <Text>Orders are up 12% this week. Two items still need a review before Friday.</Text>
        <TextInput label="Project name" value="Spring launch" onChange={none} />
        <SegmentedControl label="Range" value="week" onChange={none}>
          <SegmentedControlItem value="day" label="Day" />
          <SegmentedControlItem value="week" label="Week" />
          <SegmentedControlItem value="month" label="Month" />
        </SegmentedControl>
        <ProgressBar label="Launch checklist" value={68} hasValueLabel />
        <Switch label="Email me updates" value onChange={none} />
        <HStack gap={2}>
          <Button label="Publish" variant="primary" />
          <Button label="Preview" variant="secondary" />
        </HStack>
      </VStack>
    </Card>
  );
}
