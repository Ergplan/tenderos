// Format 7.3A: Bank Guarantee for EMD (RfS pp. 74-75), the RfS wording with its blanks as
// {{key}} placeholders. The syntax is described in ./index.js.
export default {
  omit: [],
  text: `# Format 7.3A
# FORMAT FOR BANK GUARANTEE TOWARDS EARNEST MONEY DEPOSIT (EMD)

> (To be stamped in accordance with Stamp Act, the Non-Judicial Stamp Paper of Appropriate Value)

Reference: {{reference}}
Bank Guarantee No.: {{bgNo}}
Date: {{bgDate}}

In consideration of the {{bidder}} (hereinafter referred to as 'Bidder') submitting the response to RfS inter alia for Selection of RE Power Developers for Supply of 1000 MW of Round-The-Clock Thermal Mimic Power from ISTS-Connected Renewable Energy (RE) Power Projects in India under Tariff-based Competitive Bidding (SECI-RTC-TM-V) of the capacity of {{contractedMw}} MW for supply of power therefrom on long term basis, in response to the RfS No. {{rfsNo}} dated {{rfsDate}} issued by Solar Energy Corporation of India Limited (hereinafter referred to as SECI) and SECI considering such response to the RfS of {{bidder}} as per the terms of the RfS, the {{bank}} hereby agrees unequivocally, irrevocably and unconditionally to pay to SECI at {{place}} forthwith without demur on demand in writing from SECI or any Officer authorized by it in this behalf, any amount upto and not exceeding Rupees {{emdAmount:num}}, only, on behalf of M/s {{bidder}}.

This guarantee shall be valid and binding on this Bank up to and including {{validUpTo}} and shall not be terminable by notice or any change in the constitution of the Bank or the term of contract or by any other reasons whatsoever and our liability hereunder shall not be impaired or discharged by any extension of time or variations or alternations made, given, or agreed with or without our knowledge or consent, by or between parties to the respective agreement.

Our liability under this Guarantee is restricted to INR {{emdAmount:num}} (Indian Rupees {{emdAmount:words}} only). Our Guarantee shall remain in force until {{validUpTo}}.

The Guarantor Bank hereby agrees and acknowledges that the SECI shall have a right to invoke this BANK GUARANTEE in part or in full, as it may deem fit.

The Guarantor Bank hereby expressly agrees that it shall not require any proof in addition to the written demand by SECI, made in any format, raised at the above-mentioned address of the Guarantor Bank, in order to make the said payment to SECI.

The Guarantor Bank shall make payment hereunder on first demand without restriction or conditions and notwithstanding any objection by {{bidder}} and/ or any other person. The Guarantor Bank shall not require SECI to justify the invocation of this BANK GUARANTEE, nor shall the Guarantor Bank have any recourse against SECI in respect of any payment made hereunder.

This BANK GUARANTEE shall be interpreted in accordance with the laws of India and the courts at New Delhi shall have exclusive jurisdiction.

The Guarantor Bank represents that this BANK GUARANTEE has been established in such form and with such content that it is fully enforceable in accordance with its terms as against the Guarantor Bank in the manner provided herein.

This BANK GUARANTEE shall not be affected in any manner by reason of merger, amalgamation, restructuring or any other change in the constitution of the Guarantor Bank.

This BANK GUARANTEE shall be a primary obligation of the Guarantor Bank and accordingly SECI shall not be obliged before enforcing this BANK GUARANTEE to take any action in any court or arbitral proceedings against the Bidder, to make any claim against or any demand on the Bidder or to give any notice to the Bidder or to enforce any security held by SECI or to exercise, levy or enforce any distress, diligence or other process against the Bidder.

This BANK GUARANTEE shall be effective only when the Bank Guarantee issuance message is transmitted by the issuing Bank through SFMS to IDFC First Bank and a confirmation in this regard is received by SECI.

Notwithstanding anything contained hereinabove, our liability under this Guarantee is restricted to INR {{emdAmount:num}} (Indian Rupees {{emdAmount:words}} Only) and it shall remain in force until {{validUpTo}}. SECI shall be entitled to invoke this Guarantee till {{claimUpTo}}.

We are liable to pay the guaranteed amount or any part thereof under this Bank Guarantee only if SECI serves upon us a written claim or demand.

Signature: ____________________
Name: {{bankSignatory}}
Power of Attorney No.: {{bankPoa}}
For {{bank}}
Contact Details of the Bank: {{bankContact}}
E-mail ID of the Bank: {{bankEmail}}
Banker's Stamp and Full Address.
Dated this {{dated}}
`,
};
