// Hand-written picture example: no pinned template composes a table from its parts.
// pictures: TableHeader TableBody TableFooter TableRow TableCell TableHeaderCell
import {Table, TableHeader, TableBody, TableFooter, TableRow, TableCell, TableHeaderCell} from '@astryxdesign/core/Table';
const rows = [['Ada Lovelace', 'Engineering', '12'], ['Grace Hopper', 'Research', '9'], ['Alan Turing', 'Security', '7']];
export default function TablePartsPicture() {
  return (
    <div style={{width: 520}}><Table>
      <TableHeader><TableRow><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Team</TableHeaderCell><TableHeaderCell>Reviews</TableHeaderCell></TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row[0]}>{row.map(cell => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody>
      <TableFooter><TableRow><TableCell>Total</TableCell><TableCell /><TableCell>28</TableCell></TableRow></TableFooter>
    </Table></div>
  );
}
