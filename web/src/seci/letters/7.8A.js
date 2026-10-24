// Format 7.8A: Disclosure (common shareholder 10-26%) (RfS pp. 103-104), the RfS wording with its
// blanks as {{key}} placeholders. The syntax is described in ./index.js.
export default {
  omit: [],
  text: `# Format 7.8A
# FORMAT FOR DISCLOSURE

> (To be submitted on the Letter Head of the Bidding Company/ Each Member of Consortium)
> (To be submitted by all such bidders in which a common Company/companies directly/indirectly own(s) more than 10% but less than 26% shareholding)

# DISCLOSURE

Ref. No. {{refNo}}
Date: {{date}}

From: {{bidder}}
Tel. #: {{phoneEmail}}
E-mail address#: {{email}}

To
Solar Energy Corporation of India Limited
6th Floor, Plate-B, NBCC Office Block Tower-2,
East Kidwai Nagar, New Delhi - 110 023

Sub: Response to RfS No. {{rfsNo}} dated {{rfsDate}} for {{title}}.

Dear Sir/ Madam,

We hereby declare and confirm that in terms of the definitions of the RfS, M/s {{commonShareholder}} is our Group Company, and has a direct/indirect shareholding of less than 26% in the bidding company. M/s {{commonShareholder}} also holds directly/indirectly less than 26% shareholding in other Companies which may participate in this RfS, i.e. RfS No. {{rfsNo}}.

We undertake that M/s {{commonShareholder}} is not a party to the decision-making process for submission of response to this RfS by M/s {{biddingEntity}}. We further undertake that while undertaking any action as part of our response to RfS, we are not complicit with other such bidders participating in this RfS, in which M/s {{commonShareholder}} has less than 26% direct/indirect shareholding, if any.

We further declare and confirm that in terms of the definitions of the RfS, M/s {{promoters}} is/are our Promoter(s), and has/have a direct/indirect Control in the bidding company as per the Companies Act 2013. No other entity has a direct/indirect control in the bidding company except the entity(ies) mentioned above.

We further declare that the above statement is true & correct. We undertake that if at any stage it is found to be incorrect, in addition to actions applicable under the RfS/PPA including but not limited to cancellation of our response to this RfS and LoA/PPA as applicable, we, i.e. M/s {{biddingEntity}}, including our Parent, Ultimate Parent, and our Affiliates shall be suspended/debarred from participating in any of the upcoming tenders issued by SECI for a period of 2 years from the date of default as notified by SECI.

We also understand that the above is in addition to the penal consequences that may follow from the relevant laws for the time being in force.

We further declare that we have read the provisions of Clause 33.4 of the RfS, and are complying with the requirements as per the referred OM dated 23.02.2023 except Sl. 17 of the OM, including subsequent amendments and clarifications thereto. Accordingly, we are also enclosing necessary certificates (Annexure to this format) in support of the above compliance under the RfS. We understand that in case of us being selected under this RfS, any of the above certificates is found false, SECI shall take appropriate action as deemed necessary.

We further declare that we are fully aware of the binding provisions of the ALMM Order and the Lists(s) thereunder, while quoting the tariff in RfS for {{title}}.

We further understand that the solar PV modules and solar PV cells used in the Projects under this RfS shall be from the models and manufacturers included in ALMM List-I (for solar PV modules) and ALMM List-II (for solar PV cells) as published by MNRE and valid as on the date of invoicing of such modules.

We also further understand and accept that we shall be liable for penal action, including but not limited to blacklisting and invocation of Performance Bank Guarantee, if we are found not complying with the provisions of ALMM Order, including those mentioned above.

Dated the {{dated}}
Thanking you,
We remain,
Yours faithfully,

{{signatory}}
Name, Designation, Seal and Signature of Authorized Person in whose name Power of Attorney/ Board Resolution/ Declaration.
`,
};
