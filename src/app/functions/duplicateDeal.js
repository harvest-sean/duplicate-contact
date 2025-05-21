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

    console.log('Remapped associations:', JSON.stringify(remappedAssociations, null, 2));

    // Ensure we have original_deal_cloned_deal in the remapped associations
    if (!remappedAssociations.original_deal_cloned_deal) {
      remappedAssociations.original_deal_cloned_deal = [];
    }
    
    // Add the original deal as an association to ensure bidirectional linking
    remappedAssociations.original_deal_cloned_deal.push({
      id: dealId,
      type: 'deals'
    });

    // Associate new deal with all related records & create bidirectional deal link
    await setAssociations(token, newDealId, remappedAssociations, dealId);

    // Update pipeline/stage (again)
    await updateDealStage(token, newDealId, {
      dealstage: "991352390",
      pipeline: "676191779"
    });

    // Create direct bidirectional association between original deal and new deal
    await createDirectDealAssociation(token, dealId, newDealId);

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

// Create direct bidirectional association between deals using the v4 API
const createDirectDealAssociation = async (token, originalDealId, newDealId) => {
  try {
    console.log(`Creating direct bidirectional association between deals: ${originalDealId} <-> ${newDealId}`);
    
    // Original deal -> New deal
    await axios.post(
      'https://api.hubapi.com/crm/v4/associations/deals/deals/batch/create',
      {
        inputs: [
          {
            from: { id: originalDealId },
            to: { id: newDealId },
            types: [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: ASSOCIATION_TYPE_IDS.original_deal_cloned_deal
              }
            ]
          }
        ]
      },
      {
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    
    // New deal -> Original deal
    await axios.post(
      'https://api.hubapi.com/crm/v4/associations/deals/deals/batch/create',
      {
        inputs: [
          {
            from: { id: newDealId },
            to: { id: originalDealId },
            types: [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: ASSOCIATION_TYPE_IDS.original_deal_cloned_deal
              }
            ]
          }
        ]
      },
      {
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    
    console.log(`Successfully created bidirectional association between deals ${originalDealId} and ${newDealId}`);
    return true;
  } catch (error) {
    console.error('Error creating direct deal association:', error.message);
    return false;
  }
};

// Fixed association handling logic
const setAssociations = async (token, newDealId, associations, originalDealId) => {
  const tasks = [];

  // Associate original deal <-> new deal (bidirectional)
  if (originalDealId && newDealId && originalDealId !== newDealId) {
    // Original deal -> new deal
    tasks.push(
      createAssociation(token, originalDealId, newDealId, 'deals', 'deals', ASSOCIATION_TYPE_IDS.original_deal_cloned_deal)
    );
    // New deal -> original deal
    tasks.push(
      createAssociation(token, newDealId, originalDealId, 'deals', 'deals', ASSOCIATION_TYPE_IDS.original_deal_cloned_deal)
    );
  }

  console.log('Associations to process:', JSON.stringify(associations, null, 2));

  // Process all associations and create connections to the new deal
  for (const [key, items] of Object.entries(associations)) {
    if (!Array.isArray(items)) continue;
    
    for (const item of items) {
      if (!item || !item.id || !item.type) continue;
      if (item.id === newDealId) continue; // Skip self-association
      
      // Get association type ID
      const typeId = ASSOCIATION_TYPE_IDS[key];
      if (!typeId) {
        console.log(`No association type ID for key: ${key}`);
        continue;
      }
      
      let fromType = 'deals';
      let toType = '';
      
      // Determine object type for association
      switch (item.type) {
        case 'contacts':
          toType = 'contacts';
          break;
        case 'companies':
          toType = 'companies';
          break;
        case 'deals':
          toType = 'deals';
          break;
        case 'tickets':
          toType = 'tickets';
          break;
        default:
          console.log(`Unknown object type: ${item.type}`);
          continue;
      }
      
      console.log(`Processing association: ${fromType}/${newDealId} -> ${toType}/${item.id} (type ${typeId})`);
      
      // Create association from new deal to the associated object
      tasks.push(
        createAssociation(token, newDealId, item.id, fromType, toType, typeId)
      );
      
      // For tickets, we need to use a more direct approach to ensure the association is created
      if (item.type === 'tickets') {
        console.log(`Creating ticket association using standard API for ticket ${item.id}`);
        
        // Try direct ticket association using the v4 batch API
        try {
          const batchResponse = await axios.post(
            'https://api.hubapi.com/crm/v4/associations/deals/tickets/batch/create',
            {
              inputs: [
                {
                  from: { id: newDealId },
                  to: { id: item.id },
                  types: [
                    {
                      associationCategory: "USER_DEFINED",
                      associationTypeId: ASSOCIATION_TYPE_IDS.ramp
                    }
                  ]
                }
              ]
            },
            {
              headers: { 
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              }
            }
          );
          console.log('Batch association response:', JSON.stringify(batchResponse.data, null, 2));
        } catch (err) {
          console.error('Error with batch association:', err.message);
          // Still try the standard method as fallback
          tasks.push(
            createAssociation(token, item.id, newDealId, toType, fromType, typeId)
          );
        }
      }
    }
  }

  // Special case: also try to find tickets via REST API directly
  try {
    console.log(`Fetching tickets for deal ${originalDealId} via REST API`);
    const ticketsResponse = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/deals/${originalDealId}/associations/tickets`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    
    if (ticketsResponse.data && ticketsResponse.data.results) {
      console.log('Found tickets via REST API:', JSON.stringify(ticketsResponse.data.results, null, 2));
      
      for (const ticket of ticketsResponse.data.results) {
        console.log(`Processing ticket association for ticket ${ticket.id} from REST API`);
        
        // Create association via batch API
        try {
          await axios.post(
            'https://api.hubapi.com/crm/v4/associations/deals/tickets/batch/create',
            {
              inputs: [
                {
                  from: { id: newDealId },
                  to: { id: ticket.id },
                  types: [
                    {
                      associationCategory: "USER_DEFINED",
                      associationTypeId: ASSOCIATION_TYPE_IDS.ramp
                    }
                  ]
                }
              ]
            },
            {
              headers: { 
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              }
            }
          );
          
          // Also try the reverse association
          await axios.post(
            'https://api.hubapi.com/crm/v4/associations/tickets/deals/batch/create',
            {
              inputs: [
                {
                  from: { id: ticket.id },
                  to: { id: newDealId },
                  types: [
                    {
                      associationCategory: "USER_DEFINED",
                      associationTypeId: ASSOCIATION_TYPE_IDS.ramp
                    }
                  ]
                }
              ]
            },
            {
              headers: { 
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              }
            }
          );
        } catch (err) {
          console.error('Error with batch API for tickets:', err.message);
          // Fallback to standard method
          tasks.push(
            createAssociation(token, newDealId, ticket.id, 'deals', 'tickets', ASSOCIATION_TYPE_IDS.ramp)
          );
          tasks.push(
            createAssociation(token, ticket.id, newDealId, 'tickets', 'deals', ASSOCIATION_TYPE_IDS.ramp)
          );
        }
      }
    }
  } catch (error) {
    console.error('Error fetching tickets via REST API:', error.message);
  }

  // Execute all association tasks in parallel
  try {
    await Promise.all(tasks);
    console.log(`Successfully created ${tasks.length} associations for deal ${newDealId}`);
  } catch (error) {
    console.error('Error creating associations:', error);
    throw error;
  }
};

const createAssociation = async (token, fromId, toId, fromType, toType, associationTypeId) => {
  if (!fromId || !toId || !associationTypeId) return;
  
  // Log details for debugging
  console.log(`Creating association: ${fromType}/${fromId} -> ${toType}/${toId} (type ${associationTypeId})`);
  
  const url = `https://api.hubapi.com/crm/v3/objects/${fromType}/${fromId}/associations/${toType}/${toId}/${associationTypeId}`;
  
  try {
    const response = await axios.put(url, {}, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    console.log(`Association created successfully: ${fromType}/${fromId} -> ${toType}/${toId}`);
    return true;
  } catch (err) {
    console.error(`Failed to associate ${fromType} ${fromId} to ${toType} ${toId} (typeId: ${associationTypeId}):`, err.message);
    
    // Try alternative association method for tickets
    if (toType === 'tickets' || fromType === 'tickets') {
      console.log(`Trying alternative association method for ticket ${toType === 'tickets' ? toId : fromId}`);
      try {
        // Try the v4 API for associations
        const endpoint = `https://api.hubapi.com/crm/v4/associations/${fromType}/${toType}/batch/create`;
        await axios.post(endpoint, {
          inputs: [
            {
              from: { id: fromId },
              to: { id: toId },
              types: [
                {
                  associationCategory: "USER_DEFINED",
                  associationTypeId: associationTypeId
                }
              ]
            }
          ]
        }, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        console.log(`V4 API association created successfully: ${fromType}/${fromId} -> ${toType}/${toId}`);
        return true;
      } catch (v4Err) {
        console.error(`V4 API association also failed: ${v4Err.message}`);
        return false;
      }
    }
    
    return false;
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