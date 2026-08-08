import { value } from '../lib/mod'

export const dynamic = 'force-dynamic'

// One text node, not `value: {value}` — React separates adjacent JSX children
// with a <!-- --> comment, which would break the probe's substring match.
export default function Page() {
  return <p>{`value: ${value}`}</p>
}
