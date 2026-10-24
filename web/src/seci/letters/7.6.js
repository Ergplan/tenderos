// Format 7.6: Financial Requirement (RfS pp. 96-99), the RfS wording with its blanks as {{key}}
// placeholders. The syntax is described in ./index.js.
export default {
  omit: [
    // the RfS prints both dates ("as on the last date of Financial Year 2024-25 or ... 7 days prior
    // to the bid submission deadline") for the bidder to strike one by hand
    "netWorthYear",
    // the affiliates' rows of the exhibits, when affiliates are relied on: the CA's computation
    // attached with the format; the exhibits print the bidder's own figures
    "netWorthTable", "turnoverTable", "pbditTable",
  ],
  text: `# Format 7.6
# FORMAT FOR FINANCIAL REQUIREMENT

> (This should be submitted on the Letter Head of the Bidding Company/ Lead Member of Consortium)

Ref. No. {{refNo}}
Date: {{date}}

From: {{bidder}}
{{address}}
Tel.#: {{phoneEmail}}
E-mail address#: {{email}}

To
Solar Energy Corporation of India Limited
6th Floor, Plate-B, NBCC Office Block Tower-2,
East Kidwai Nagar, New Delhi - 110 023

Sub: Response to RfS No. {{rfs}} dated {{rfsDate}} for {{title}}.

Dear Sir/ Madam,

We certify that the Bidding Company/Member in a Bidding Consortium is meeting the financial eligibility requirements as per the provisions of the RfS. Accordingly, the Bidder, [[affiliateSupport=Yes, with affiliates|with the support of its Affiliates, (strike out if not applicable)]] is fulfilling the minimum Net Worth criteria, by demonstrating a Net Worth of Rs. {{netWorthCr:num}} Cr. ({{netWorthCr:words}} Crore in words) as on the last date of Financial Year 2024-25 or as on the date at least 7 days prior to the bid submission deadline (Strike out wherever not applicable).

This Net Worth has been calculated in accordance with instructions provided in Clause 35.1 of the RfS.

[only company] Exhibit (i): Applicable in case of Bidding Company
For the above calculations, we have considered the Net Worth by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose net worth is to be considered | Relationship with Bidding Company* | Net Worth (in Rs. Crore) |
| Company 1: {{bidder}} | – | – | {{netWorthCr:num}} |
| Total | | | {{netWorthCr:num}} |

> *The column for "Relationship with Bidding Company" is to be filled only in case the financial capability of Affiliate has been used for meeting Qualification Requirements. Further, documentary evidence to establish the relationship, duly certified by a practicing company secretary/ chartered accountant is required to be attached with the format.

[only consortium] Exhibit (ii): Applicable in case of Bidding Consortium
(To be filled by each Member in a Bidding Consortium separately)
Name of Member: {{bidder}}
Net Worth Requirement to be met by Member: INR {{memberNetWorthReq:num}} Crore
For the above calculations, we have considered Net Worth by Member in Bidding Consortium and/ or its Affiliate(s) per following details:

Further, we certify that the Bidding Company/ Member in the Bidding Consortium, [[affiliateSupport=Yes, with affiliates|with the support of its Affiliates, (strike out if not applicable)]] is fulfilling the minimum Annual Turnover Criteria, by demonstrating an Annual Turnover of INR {{turnover:num}} ({{turnover:words}} in words) as on the end of Financial Year 2024-25 or as on the day at least 7 days prior to the bid submission deadline (choose one). (Strike out if not applicable)

[only company] Exhibit (i): Applicable in case of Bidding Company
For the above calculations, we have considered the Annual Turnover by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose Annual Turnover is to be considered | Relationship with Bidding Company* | Annual Turnover (In Rs. Crore) |
| Company 1: {{bidder}} | – | – | {{turnover:crore}} |
| Total | | | {{turnover:crore}} |

> *The column for "Relationship with Bidding Company" is to be filled only in case the financial capability of Affiliate has been used for meeting Qualification Requirements. Further, documentary evidence to establish the relationship, duly certified by a practicing company secretary/chartered accountant is required to be attached with the format.

[only consortium] Exhibit (ii): Applicable in case of Bidding Consortium
(To be filled by each Member in a Bidding Consortium separately)
Name of Member: {{bidder}}
Annual Turnover Requirement to be met by Member: INR -------------Crore
For the above calculations, we have considered Annual Turnover by Member in Bidding Consortium and/ or its Affiliate(s) as per following details:

Further, we certify that the Bidding Company/ Member in the Bidding Consortium, [[affiliateSupport=Yes, with affiliates|with the support of its Affiliates, (strike out if not applicable)]] is fulfilling the minimum Profit Before Depreciation Interest and Taxes (PBDIT) criteria as mentioned in the RfS, by demonstrating a PBDIT of INR {{pbdit:num}} ({{pbdit:words}} in words) as on the end of Financial Year 2024-25 or as on the day at least 7 days prior to the bid submission deadline. (Strike out if not applicable)

[only company] Exhibit (i): Applicable in case of Bidding Company
For the above calculations, we have considered the PBDIT by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose PBDIT is to be considered | Relationship with Bidding Company* | PBDIT (in Rs. Crore) |
| Company 1: {{bidder}} | – | – | {{pbdit:crore}} |
| Total | | | {{pbdit:crore}} |

> *The column for "Relationship with Bidding Company" is to be filled only in case the financial capability of Affiliate has been used for meeting Qualification Requirements. Further, documentary evidence to establish the relationship, duly certified by a practicing company secretary/chartered accountant is required to be attached with the format.

[only consortium] Exhibit (ii): Applicable in case of Bidding Consortium
(To be filled by each Member in a Bidding Consortium separately)
Name of Member: {{bidder}}
PBDIT Requirement to be met by Member: INR -------------Crore
For the above calculations, we have considered PDBIT by Member in Bidding Consortium and/ or its Affiliate(s) as per following details:

| {{signatory}} | {{caDetails}}\\nMembership No. {{caMembershipNo}}\\nRegn. No. of the CA's Firm: {{caFirmRegnNo}}\\nUDIN: {{caUdin}} |
| (Signature & Name of the Authorized Signatory) | (Signature and Stamp of CA) |

Date: {{caDate}}

> Note: (i) Along with the above format, in a separate sheet on the letterhead of the Chartered Accountant's Firm, provide details of computation of Net Worth and Annual Turnover/PBDIT (as applicable) duly certified by the Chartered Accountant.
> (ii) Certified copies of Balance sheet, Profit & Loss Account, Schedules and Cash Flow Statements are to be enclosed in complete form along with all the Notes to Accounts.
> (iii) In case of the Bidder choosing to meet the Liquidity criteria through an In-principle sanction letter, such document shall be separately submitted by the bidder as part of the bidder's Response to RfS.
`,
};
