// Format 7.2: Power of Attorney (RfS pp. 72-73), the RfS wording with its blanks as {{key}}
// placeholders. The syntax is described in ./index.js.
export default {
  omit: [],
  text: `# Format 7.2
# FORMAT FOR POWER OF ATTORNEY

> (Applicable Only in case of Consortium)
> (To be provided by each of the other members of the Consortium in favor of the Lead Member)
> (To be stamped in accordance with Stamp Act, the Non-Judicial Stamp Paper of Appropriate Value)

KNOW ALL MEN BY THESE PRESENTS THAT {{members}}, the Members of Consortium have formed a Bidding Consortium named {{consortiumName}} (hereinafter called the ‘Consortium’) vide Consortium Agreement dated {{consortiumAgreementDate}} and having agreed to appoint M/s {{leadMember}} as the Lead Member of the said Consortium do hereby constitute, nominate and appoint M/s {{leadMember}} a company incorporated under the laws of {{leadMemberCountry}} and having its Registered/ Head Office at {{leadMemberOffice}} as our duly constituted lawful Attorney (hereinafter called as Lead Member) to exercise all or any of the powers for and on behalf of the Consortium in regard to submission of the response to RfS No {{rfsNo}}.

We also authorize the said Lead Member to undertake the following acts:
i) To submit on behalf of Consortium Members response to RfS.
ii) To do any other act or submit any information and document related to the above response to RfS Bid.

It is expressly understood that in the event of the Consortium being selected as Successful Bidder, this Power of Attorney shall remain valid, binding and irrevocable until the Bidding Consortium achieves execution of PPA.

We as the Member of the Consortium agree and undertake to ratify and confirm all whatsoever the said Attorney/ Lead Member has done on behalf of the Consortium Members pursuant to this Power of Attorney and the same shall bind us and deemed to have been done by us.

IN WITNESS WHEREOF M/s ………………………………………….……., as the Member of the Consortium have executed these presents on this {{executedOn}} under the Common Seal of our company.

For and on behalf of Consortium Member
M/s………………………….
{{memberSignatory}} (Signature of person authorized by the board)
(Name
Designation
Place:
Date:)

Accepted

{{leadAcceptance}}
(Signature, Name, Designation and Address of the person authorized by the board of the Lead Member)

Attested

---------------------
(Signature of the executant)

------------------------------
(Signature & stamp of Notary of the place of execution)

Place: {{notary}}
Date: ------------------
`,
};
