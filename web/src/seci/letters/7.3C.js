// Format 7.3C: Insurance Surety Bond for EMD (RfS pp. 79-80), the RfS wording with its blanks as
// {{key}} placeholders. The syntax is described in ./index.js.
export default {
  omit: [],
  text: `# Format 7.3C
# FORMAT OF INSURANCE SURETY BOND TOWARDS EMD

> (To be stamped in accordance with stamp act of India)

Insurance Surety Bond No.: {{bondNo}}
Date:

To,
Solar Energy Corporation of India Limited,
6th Floor, Plate-B, NBCC Office Block Tower-2,
East Kidwai Nagar, New Delhi - 110 023

Dear Sir,

In accordance with your RfS No. {{rfsNo}} dated {{rfsDate}}., M/s {{bidder}} having its Registered/Head Office at {{address}} (hereinafter referred to as ‘bidder’) wish to participate in the said bid for {{title}}.

As an irrevocable Insurance Surety Bond against Bid Security for an amount of {{emdAmount}} valid for {{validUpTo}} required to be submitted by the bidder as a condition precedent for participation in the said bid which amount is liable to be forfeited on the happening of any contingencies as mentioned under the RfS Documents.

We, the {{insurer}} having our Head Office at {{insurerAddress}} guarantee and undertake to pay immediately on demand by Solar Energy Corporation of India Limited (hereinafter referred to as 'SECI') the amount of {{emdAmount}} without any condition, demur, reservation, contest, recourse or protest and/or without any reference to the Bidder. Any such demand made by SECI shall be conclusive and binding on us irrespective of any dispute or difference raised by the Bidder and/or any right/remedy available to the Bidder in terms thereof.

This Insurance Surety Bond shall be unequivocal, unconditional as well as irrevocable and shall remain valid upto {{validUpTo}}. If any further extension of this Insurance Surety Bond is required, the same shall be extended to such required period on receiving instructions from M/s {{bidder}} on whose behalf this Insurance Surety Bond is issued.

The Insurer hereby agrees and acknowledges that the SECI shall have a right to invoke this Insurance Surety Bond in part or in full, as it may deem fit.

The Insurer hereby expressly agrees that it shall not require any proof in addition to the written demand by SECI, made in any format, raised at the above-mentioned address of the Insurer, in order to make the said payment to SECI.

The Insurer shall make payment hereunder on first demand without restriction or conditions and notwithstanding any objection by {{bidder}} and/ or any other person. The Insurer shall not require SECI to justify the invocation of this Insurance Surety Bond, nor shall the Insurer have any recourse against SECI in respect of any payment made hereunder. SECI shall be entitled to invoke this Bond till {{claimUpTo}}.

This Insurance Surety Bond shall not be affected in any manner by reason of merger, amalgamation, restructuring or any other change in the constitution of the Insurer.

This Insurance Surety Bond shall be a primary obligation of the Insurer and accordingly SECI shall not be obliged before enforcing this Insurance Surety Bond to take any action in any court or arbitral proceedings against the Bidder, to make any claim against or any demand on the Bidder or to give any notice to the Bidder or to enforce any security held by SECI or to exercise, levy or enforce any distress, diligence or other process against the Bidder.

In witness where of the Insurer, through its authorized officer, has set its hand and stamp on this ................ day of ............ 20.......... at {{executed}}

...............................................
(Signature)
{{insurerSignatory}}
(Name)
...............................................
(Designation with Insurer Stamp)
Power of Attorney No........................
Date....................................
Email id of the Branch for confirmation of this Bond: {{branchEmail}}

NOTE:
1. The Insurance Surety Bond shall be from an Insurer as per guidelines issued by Insurance Regulatory and Development Authority of India (IRDAI) as amended from time to time.
2. SECI shall be the Creditor, the bidder shall be the Principal debtor and the Insurance company/Insurer shall be the Surety in respect of the Insurance Surety Bond to be issued by the Insurer.
3. The Insurance Surety Bond should be on Non-Judicial stamp paper/e-stamp paper of appropriate value as per Stamp Act prevailing in the state(s) where the Insurance Surety Bond is submitted or is to be acted upon or the rate prevailing in State where the Insurance Surety Bond is executed, whichever is higher. The Stamp Paper/e-stamp paper shall be purchased in the name of bidder/Insurer issuing the Insurance Surety Bond.
`,
};
