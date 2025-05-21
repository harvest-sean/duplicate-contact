const axios = require('axios');

const ASSOCIATION_TYPE_IDS = {
  original_deal_cloned_deal: 79, // User-defined: Cloned Deal (deals to deals)
  ramp: 116,                     // User-defined: Ramp (deals to tickets)
  deal_contact: 3,               // Default: deals to contacts
  DEAL_TO_COMPANY: 5,            // Default: deals to companies
};

const ASSOCIATION_KEY_MAP = {
  contact_collection__deal_to_contact: 'deal_contact',
  company_collection__deal_to_company_unlabeled: 'DEAL_TO_COMPANY',
  deal_collection__original_deal_cloned_deal: 'original_deal_cloned_deal',
  ticket_collection__deal_to_ticket: 'ramp', // Map tickets to 'ramp'
};

exports.main = async (context = {}) => {
  console.log('duplicateDeal function triggered!');
  console.log('Context:', JSON.stringify(context, null, 2));

  try {
    const { dealId, associations = {} } = context.parameters || {};
    const token = process.env['PRIVATE_APP_ACCESS_TOKEN'];

    if (!dealId) return { status: 'error', message: 'No deal id provided!' };
    if (!token) return { status: 'error', message: 'No HubSpot Private App token available!' };

    // Fetch properties
    const dealData = await fetchDealData(token, dealId);
    const customFields = await fetchCustomDealFields(token, dealId);
    const originalProperties = { ...dealData, ...customFields };

    // Count previous clones for correct deal name/numbering
    let clonedDealsCount = 0;
    try {
      const assocRes = await axios.post(
        'https://api.hubapi.com/collector/graphql',
        JSON.stringify({
          operationName: 'data',
          query: `
            query data ($id: String!) {
              CRM {
                deal(uniqueIdentifier: "hs_object_id", uniqueIdentifierValue: $id) {
                  associations {
                    deal_collection__original_deal_cloned_deal { items { hs_object_id } }
                  }
                }
              }
            }`,
          variables: { id: String(dealId) }
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }
        }
      );
      const items = assocRes.data?.data?.CRM?.deal?.associations?.deal_collection__original_deal_cloned_deal?.items || [];
      clonedDealsCount = items.length;
    } catch (e) {
      // fail silently
    }

    // Prepare new deal's properties
    const originalDealName = originalProperties.dealname || 'Unnamed Deal';
    const newDealNumber = clonedDealsCount + 2;
    const baseDealName = originalDealName.replace(/\s\d+$/, '');
    const updatedDealName = `${baseDealName} ${newDealNumber}`;
    const updatedPropertiesData = {
      ...originalProperties,
      dealname: updatedDealName,
      deal_number: String(newDealNumber),
      dealstage: "991352390",
      pipeline: "676191779"
    };

    // Filter/sanitize properties
    const filtered = filterProperties(updatedPropertiesData);
    const withValues = extractValues(filtered);
    const finalProperties = filterEmptyProperties(withValues);

    // Create the new deal (POST)
    const newDealId = await createDeal(token, finalProperties);

    // Remap associations for internal label usage
    const remappedAssociations = {};
    for (const [label, items] of Object.entries(associations)) {
      const mappedKey = ASSOCIATION_KEY_MAP[label] || label;
      remappedAssociations[mappedKey] = items;
    }

    // Associate new deal with all related records & create bidirectional deal link
    await setAssociations(token, newDealId, remappedAssociations, dealId);

    // Update pipeline/stage (again)
    await updateDealStage(token, newDealId, {
      dealstage: "991352390",
      pipeline: "676191779"
    });

    return { status: "ok", newDealId };
  } catch (error) {
    return { status: "error", message: error.message, stack: error.stack };
  }
};

const fetchDealData = async (token, dealId) => {
  const response = await axios.get(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.properties;
};

const fetchCustomDealFields = async (token, dealId) => {
  const customProps = [
    "accounting_currency", "deal_type_", "acquiring_profitability__rate", "of_potential_clients",
    "deal_number", "funding", "primary_trade_name", "reporting_name", "solutions_design_document_link",
    "solutions_review_owner", "technical_review_link", "tier", "travel_type", "bonus", "bonus_amount",
    "bonus_terms", "bonus_type", "closed_won_reason_s_", "closed_won_notes", "company_revenue",
    "company_type", "contract_date", "contract_link", "contracted_minimum_volume__annualized_",
    "customer_care_representative", "customer_success_manager", "estimated_annual_ach_in_volume",
    "estimated_annual_ach_out_volume", "estimated_annual_acquiring_volume",
    "estimated_annual_push_to_card_volume", "estimated_annual_issuing_volume",
    "total_potential_annual_pay_in_volume", "total_potential_annual_pay_out_volume", "hubspot_owner_id",
    "disqualification_notes", "disqualification_reasons", "expiration_date", "expected_start_date",
    "go_live_target_date__pay_in_", "implementation_manager", "issuing_profitability__rate", "keep_rate",
    "last_bonus_payout_date", "merchant_of_record", "needs_analysis_notes", "notice_period__in_days_",
    "notification_period_to_terminate__in_days_", "partnership_type", "pay_in___pay_out",
    "performance_bonus_frequency", "performance_effective_date", "performance_minimum_threshold", "pricing",
    "pricing_model", "proposal_link", "revenue_share", "sign_on_effective_date", "signing_date",
    "term__in_years_", "underwriting_comments", "underwriting_denial_reason_s_", "underwriting_status"
  ].join(",");
  const response = await axios.get(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=${customProps}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.properties;
};

const createDeal = async (token, properties) => {
  const res = await axios.post(
    'https://api.hubapi.com/crm/v3/objects/deals',
    { properties },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
  );
  return res.data.id;
};

const updateDealStage = async (token, dealId, properties) => {
  await axios.patch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    { properties },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
  );
};

// --- UPDATED LOGIC STARTS HERE ---

const setAssociations = async (token, newDealId, associations, originalDealId) => {
  const tasks = [];

  // Original <-> Clone (both directions for deals)
  if (originalDealId && newDealId && originalDealId !== newDealId) {
    // Associate original -> clone
    tasks.push(
      createAssociation(token, originalDealId, newDealId, 'deals', 'deals', ASSOCIATION_TYPE_IDS.original_deal_cloned_deal)
    );
    // Associate clone -> original
    tasks.push(
      createAssociation(token, newDealId, originalDealId, 'deals', 'deals', ASSOCIATION_TYPE_IDS.original_deal_cloned_deal)
    );
  }

  // Associate the clone with all related records
  for (const [label, assocList] of Object.entries(associations)) {
    const typeId = ASSOCIATION_TYPE_IDS[label];
    if (!typeId) continue;
    if (!Array.isArray(assocList)) continue;
    for (const assoc of assocList) {
      if (!assoc?.id || !assoc?.type) continue;
      if (assoc.id === newDealId) continue;

      // --- TICKETS ---
      if (label === 'ramp' && assoc.type === 'tickets') {
        // Associate deal (newDealId) <-> ticket (assoc.id)
        tasks.push(createAssociation(token, newDealId, assoc.id, 'deals', 'tickets', ASSOCIATION_TYPE_IDS.ramp));
        // (Optional: If you want the ticket to show the new deal in its associations, also do this:)
        tasks.push(createAssociation(token, assoc.id, newDealId, 'tickets', 'deals', ASSOCIATION_TYPE_IDS.ramp));
        continue;
      }

      // --- DEALS ---
      if (label === 'original_deal_cloned_deal' && assoc.type === 'deals') {
        // Avoid duplicating the bidirectional link already set above
        // (If you want to copy all other deal associations as well, keep this line)
        tasks.push(createAssociation(token, newDealId, assoc.id, 'deals', 'deals', ASSOCIATION_TYPE_IDS.original_deal_cloned_deal));
        continue;
      }

      // --- CONTACTS ---
      if (label === 'deal_contact' && assoc.type === 'contacts') {
        tasks.push(createAssociation(token, newDealId, assoc.id, 'deals', 'contacts', ASSOCIATION_TYPE_IDS.deal_contact));
        continue;
      }

      // --- COMPANIES ---
      if (label === 'DEAL_TO_COMPANY' && assoc.type === 'companies') {
        tasks.push(createAssociation(token, newDealId, assoc.id, 'deals', 'companies', ASSOCIATION_TYPE_IDS.DEAL_TO_COMPANY));
        continue;
      }
    }
  }

  await Promise.all(tasks);
};

const createAssociation = async (token, fromId, toId, fromType, toType, associationTypeId) => {
  if (!fromId || !toId || !associationTypeId) return;
  const url = `https://api.hubapi.com/crm/v3/objects/${fromType}/${fromId}/associations/${toType}/${toId}/${associationTypeId}`;
  try {
    await axios.put(url, {}, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(`Failed to associate ${fromType} ${fromId} to ${toType} ${toId} (typeId: ${associationTypeId}):`, err.message);
  }
};

const filterProperties = (props) => {
  const exclude = ['hs_object_id', 'associations'];
  return Object.fromEntries(Object.entries(props).filter(([k, v]) => !exclude.includes(k) && v != null));
};
const extractValues = (props) => {
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === 'object' && v?.value ? v.value : v]));
};
const filterEmptyProperties = (props) => {
  return Object.fromEntries(Object.entries(props).filter(([k, v]) => v !== null && v !== undefined));
};