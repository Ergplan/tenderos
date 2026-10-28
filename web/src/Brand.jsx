/** TenderOS brand lockup used on every page: the light-type logo at night, the dark-type one by day. */
export default function Brand({ size = "md", product = true, className = "" }) {
  return (
    <span className={`jw-brand jw-${size} ${className}`}>
      <img className="brand-night" src="/brand/tenderos-logo-dark.png" alt="TenderOS" width={981} height={230} />
      <img className="brand-day" src="/brand/tenderos-logo.png" alt="" aria-hidden="true" width={981} height={230} />
      {product && <small>Tender to bid · RE &amp; storage</small>}
    </span>
  );
}
