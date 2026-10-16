/** TenderOS brand lockup used on every page. */
export default function Brand({ size = "md", product = true, className = "" }) {
  return (
    <span className={`jw-brand jw-${size} ${className}`}>
      <img src="/brand/tenderos-logo-dark.png" alt="TenderOS" width={981} height={230} />
      {product && <small>Tender to bid · RE &amp; storage</small>}
    </span>
  );
}
