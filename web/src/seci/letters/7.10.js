// Format 7.10: Financial Bid covering letter (RfS pp. 107-108), the RfS wording with its blanks as
// {{key}} placeholders. The syntax is described in ./index.js.
export default {
  // the tariff is entered once in the ISN-ETS financial e-form (Notes 2, 4, 5), not on this letter;
  // the format's tariff blanks keep it beside the letter for the e-form
  omit: ["tariff", "tariffWords"],
  text: `# Format 7.10
# FORMAT FOR SUBMISSION OF FINANCIAL BID

> (The Covering Letter should be submitted on the Letter Head of the Bidding Company/ Lead Member of Consortium)

Ref. No. {{refNo}}
Date: {{date}}

From: {{bidder}}
{{address}}
Tel.#: {{phone}}
E-mail address#: {{email}}

To
Solar Energy Corporation of India Limited
6th Floor, Plate-B, NBCC Office Block Tower-2,
East Kidwai Nagar, New Delhi - 110 023

Sub: Response to RfS No. {{rfsNo}} dated {{rfsDate}} for {{title}}.

Dear Sir/ Madam,

I/We, {{bidderName}} enclose herewith the Financial Proposal for selection of my/ our firm for a Contracted Capacity of {{contractedMw}} MW in India as Bidder for the above.

I/We agree that this offer shall remain valid for a period of 12 months from the due date of submission of the response to RfS and until the date of signing of PPA, pursuant to Clause 42.4 of the RfS, and such further period as may be mutually agreed upon.

Dated the {{signedDate}}.

Thanking you,
We remain,
Yours faithfully,

{{signatory}}
Name, Designation, Seal and Signature of Authorized Person in whose name Power of Attorney/ Board Resolution/ Declaration.

> Notes:
> 1. There can be only one tariff for all the projects applied for. If the Bidder quotes two tariffs or combination thereof for the projects, then the bid shall be considered as non-responsive.
> 2. If the Bidder submits the financial bid in the Electronic Form at ETS portal not in line with the instructions mentioned therein, then the bid shall be considered as non-responsive.
> 3. Tariff requirement shall be quoted as a fixed amount in Indian Rupees only. Conditional proposal shall be summarily rejected.
> 4. In the event of any discrepancy between the values entered in figures and in words, the values entered in words shall be considered.
> 5. Tariff should be in Indian Rupee up to two decimal places only.
`,
};
