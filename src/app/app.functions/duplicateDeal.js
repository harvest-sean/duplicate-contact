// duplicateDeal.js

// Importing necessary libraries
const axios = require('axios');

// Entry point for this module
exports.main = async (context = {}) => {
  const { hs_object_id } = context.propertiesToSend;
  const { associations } = context.parameters;
  const token = process.env['PRIVATE_APP_ACCESS_TOKEN'];

  try {
    console.log('--- Starting Duplicate Deal Process ---');
    console.log('Incoming hs_object_id:', hs_object_id);
    console.log('Incoming associations:', JSON.stringify(associations, null, 2));

    // Step 1: Fetch deal properties via GraphQL
    const originalProperties = await fetchProperties(token, hs_object_id);

    // Step 1.5: Fetch additional custom fields via REST
    const customFields = await fetchCustomDealFields(token, hs_object_id);

    // Step 1.6: Merge custom fields into originalProperties
    Object.assign(originalProperties, customFields);

    // Step 2: Calculate new deal name and number
    const originalDealName = originalProperties.dealname || 'Unnamed Deal';
    const originalDealNumber = originalProperties.deal_number ? parseInt(originalProperties.deal_number, 10) : 1;
    const clonesCount =
      originalProperties.associations &&
      originalProperties.associations.deal_collection__deal_to_deal
        ? originalProperties.associations.deal_collection__deal_to_deal.total
        : 0;
    const newDealNumber = originalDealNumber + clonesCount + 1;
    const baseDealName = originalDealName.replace(/\s\d+$/, '');
    const updatedDealName = `${baseDealName} ${newDealNumber}`;

    // Define updatedPropertiesData
    const updatedPropertiesData = {
      ...originalProperties,
      dealname: updatedDealName,
      deal_number: String(newDealNumber), // Convert to string - HubSpot expects string values
      dealstage: "991352390",
      pipeline: "676191779"
    };

    // Remove problematic properties that shouldn't be sent when creating a new deal
    const filteredProperties = filterProperties(updatedPropertiesData);
    
    // Debug log to see what's being filtered
    console.log('After filtering properties:', JSON.stringify(filteredProperties, null, 2));
    
    const propertiesWithValues = extractValues(filteredProperties);
    
    // Debug log to see what properties with values look like
    console.log('After extracting values:', JSON.stringify(propertiesWithValues, null, 2));
    
    const nonEmptyProperties = filterEmptyProperties(propertiesWithValues);
    
    // Debug log to see final properties being sent
    console.log('Final properties being sent:', JSON.stringify(nonEmptyProperties, null, 2));

    // Create the new deal
    const newDealId = await createDeal(token, nonEmptyProperties);
    console.log('New deal created with ID:', newDealId);

    console.log('Updating deal stage for new deal...');
    await updateDealStage(token, newDealId, { dealstage: "991352390", pipeline: "676191779" });
    console.log('Deal stage updated.');

    console.log('Setting associations for the new deal...');
    const assocData = originalProperties.associations || {};
    await setAssociations(token, newDealId, { associations: assocData }, hs_object_id);
    console.log('Associations successfully set for new deal.');

    console.log('--- Duplicate Deal Process Completed Successfully ---');
    return newDealId;
  } catch (error) {
    console.error('*** Error duplicating deal ***');
    console.error('Error message:', error.message);
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

const fetchProperties = async (token, id) => {
  const requestBody = {
    operationName: 'data',
    query: QUERY,
    variables: { id },
  };

  try {
    const response = await axios.post(
      'https://api.hubapi.com/collector/graphql',
      JSON.stringify(requestBody),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const responseBody = response.data;
    if (responseBody.errors && responseBody.errors.length > 0) {
      throw new Error(`GraphQL Error: ${responseBody.errors[0].message}`);
    }
    if (!responseBody.data?.CRM?.deal) {
      throw new Error(`Deal not found or inaccessible with ID: ${id}`);
    }
    return responseBody.data.CRM.deal;
  } catch (error) {
    console.error('Error in fetchProperties:', error.message);
    throw error;
  }
};

const fetchCustomDealFields = async (token, dealId) => {
  const customProperties = [
    "accounting_currency",
    "deal_type_",
    "acquiring_profitability__rate",
    "of_potential_clients",
    "deal_number",
    "funding",
    "primary_trade_name",
    "reporting_name",
    "solutions_design_document_link",
    "solutions_review_owner",
    "technical_review_link",
    "tier",
    "travel_type",
    "bonus",
    "bonus_amount",
    "bonus_terms",
    "bonus_type",
    "closed_won_reason_s_",
    "closed_won_notes",
    "company_revenue",
    "company_type",
    "contract_date",
    "contract_link",
    "contracted_minimum_volume__annualized_",
    "customer_care_representative",
    "customer_success_manager",
    "estimated_annual_ach_in_volume",
    "estimated_annual_ach_out_volume",
    "estimated_annual_acquiring_volume",
    "estimated_annual_push_to_card_volume",
    "estimated_annual_issuing_volume",
    "total_potential_annual_pay_in_volume",
    "total_potential_annual_pay_out_volume",
    "hubspot_owner_id",
    "disqualification_notes",
    "disqualification_reasons",
    "expiration_date",
    "expected_start_date",
    "go_live_target_date__pay_in_",
    "implementation_manager",
    "issuing_profitability__rate",
    "keep_rate",
    "last_bonus_payout_date",
    "merchant_of_record",
    "needs_analysis_notes",
    "notice_period__in_days_",
    "notification_period_to_terminate__in_days_",
    "partnership_type",
    "pay_in___pay_out",
    "performance_bonus_frequency",
    "performance_effective_date",
    "performance_minimum_threshold",
    "pricing",
    "pricing_model",
    "proposal_link",
    "revenue_share",
    "sign_on_effective_date",
    "signing_date",
    "solutions_design_document_link",
    "technical_review_link",
    "term__in_years_",
    "underwriting_comments",
    "underwriting_denial_reason_s_",
    "underwriting_status"
  ].join(",");

  try {
    const response = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=${customProperties}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.properties;
  } catch (error) {
    console.error('Error fetching custom deal fields:', error.message);
    throw error;
  }
};

const createDeal = async (token, properties) => {
  try {
    // Make sure all numeric values are properly converted to strings
    const stringifiedProperties = Object.entries(properties).reduce((acc, [key, value]) => {
      acc[key] = value !== null && value !== undefined ? String(value) : value;
      return acc;
    }, {});
    
    console.log('Sending create deal request with properties:', JSON.stringify(stringifiedProperties, null, 2));
    
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals',
      { properties: stringifiedProperties },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data.id;
  } catch (err) {
    console.error('Error creating deal:', err.message);
    if (err.response) {
      console.error('Error response data:', JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
};

const updateDealStage = async (token, dealId, properties) => {
  try {
    const response = await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
      { properties },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    console.error('Error updating deal stage:', err.message);
    throw err;
  }
};

// const setAssociations = async (token, newDealId, associationsData, originalDealId) => {
//   try {
//     console.log('Setting up associations for the new deal...');
    
//     // Create reference to original deal
//     await createAssociation(token, newDealId, originalDealId, "deal_to_deal");
    
//     // Process other associations from original deal if needed
//     const associations = associationsData.associations || {};
    
//     // Process company associations
//     if (associations.company_collection__deal_to_company_unlabeled?.items) {
//       for (const company of associations.company_collection__deal_to_company_unlabeled.items) {
//         await createAssociation(token, newDealId, company.hs_object_id, "deal_to_company");
//       }
//     }
    
//     // Process contact associations
//     if (associations.contact_collection__deal_to_contact?.items) {
//       for (const contact of associations.contact_collection__deal_to_contact.items) {
//         await createAssociation(token, newDealId, contact.hs_object_id, "deal_to_contact");
//       }
//     }
    
//     console.log('Associations setup completed');
//   } catch (error) {
//     console.error('Error setting associations:', error.message);
//     throw error;
//   }
// };

// // Helper function to create an association
// const createAssociation = async (token, fromId, toId, associationType) => {
//   try {
//     console.log(`Creating association: ${associationType} from ${fromId} to ${toId}`);
    
//     // Map association type to HubSpot association type IDs
// const typeMap = {
//   "deal_to_company": 5,
//   "deal_to_contact": 69,
//   "deal_to_deal": 79, 
//   "deal_to_ticket": 116// or your custom defined association type ID
// };
    
//     const assocType = typeMap[associationType];
//     if (!assocType) {
//       console.warn(`Unknown association type: ${associationType}`);
//       return;
//     }
    
//     const response = await axios.put(
//       `https://api.hubapi.com/crm/v4/associations/deal/${fromId}/default/${assocType}/${toId}`,
//       {},
//       {
//         headers: {
//           Authorization: `Bearer ${token}`,
//           'Content-Type': 'application/json',
//         },
//       }
//     );
    
//     console.log(`Association created successfully: ${associationType}`);
//     return response.data;
//   } catch (error) {
//     console.error(`Error creating association ${associationType}:`, error.message);
//     if (error.response) {
//       console.error('Error response:', error.response.data);
//     }
//     // Don't throw error here to allow process to continue
//     console.log(`Continuing despite association error for ${associationType}`);
//   }
// };


const setAssociations = async (token, newDealId, associationsData, originalDealId) => {
  try {
    const associations = associationsData.associations || {};

    const tasks = [];

    // Deal-to-deal (clone relationship)
    tasks.push(createAssociation(token, originalDealId, newDealId, 'deal_to_deal'));

    // Company associations
    if (associations.company_collection__deal_to_company_unlabeled?.items) {
      for (const company of associations.company_collection__deal_to_company_unlabeled.items) {
        tasks.push(createAssociation(token, newDealId, company.hs_object_id, 'deal_to_company'));
      }
    }

    // Contact associations
    if (associations.contact_collection__deal_to_contact?.items) {
      for (const contact of associations.contact_collection__deal_to_contact.items) {
        tasks.push(createAssociation(token, newDealId, contact.hs_object_id, 'deal_to_contact'));
      }
    }

    await Promise.all(tasks);
    console.log('All associations created successfully.');
  } catch (error) {
    console.error('Error setting associations:', error.message);
    throw error;
  }
};

const createAssociation = async (token, fromId, toId, associationType) => {
  try {
    const typeMap = {
  "deal_to_company": 5,
  "deal_to_contact": 69,
  "deal_to_deal": 79, 
  "deal_to_ticket": 116// or your custom defined association type ID
};
    

    const associationTypeId = typeMap[associationType];
    if (!associationTypeId) {
      console.warn(`No valid associationTypeId for ${associationType}`);
      return;
    }

    await axios.post(
      'https://api.hubapi.com/crm/v4/associations/deal/batch/create',
      {
        inputs: [
          {
            from: { id: String(fromId) },
            to: { id: String(toId) },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId
              }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Association created: ${associationType} (${fromId} -> ${toId})`);
  } catch (error) {
    console.error(`Failed to create association ${associationType}:`, error.message);
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  }
};



const filterProperties = (properties) => {
  // List of properties to explicitly exclude
  const excludeProps = [
    'hs_object_id', 
    'associations', 
    'createdate',
    'hs_lastmodifieddate',
    'hs_created_by_user_id',
    'hs_updated_by_user_id',
    'hs_object_source_id',
    'hs_mrr',
    'hs_acv'
  ];
  
  return Object.entries(properties).reduce((filtered, [key, value]) => {
    if (excludeProps.includes(key) || value === null) return filtered;
    filtered[key] = value;
    return filtered;
  }, {});
};

const extractValues = (properties) => {
  return Object.entries(properties).reduce((extracted, [key, value]) => {
    extracted[key] = value && typeof value === 'object' && 'value' in value ? value.value : value;
    return extracted;
  }, {});
};

const filterEmptyProperties = (properties) => {
  return Object.entries(properties).reduce((filtered, [key, value]) => {
    if (value !== null && value !== undefined) filtered[key] = value;
    return filtered;
  }, {});
};

// GraphQL query to fetch deal data
const QUERY = `
  query data($id: String!) {
    CRM {
      deal(uniqueIdentifier: "id", uniqueIdentifierValue: $id) {
        hs_object_id
        dealname
        dealtype
        amount
        hs_analytics_source
        associations {
          contact_collection__deal_to_contact {
            total
            items {
              hs_object_id
            }
          }
          company_collection__deal_to_company_unlabeled {
            total
            items {
              hs_object_id
            }
          }
          line_item_collection__primary {
            total
            items {
              hs_object_id
            }
          }
          quote_collection__primary {
            total
            items {
              hs_object_id
            }
          }
          ticket_collection__deal_to_ticket {
            total
            items {
              hs_object_id
            }
          }
          deal_collection__deal_to_deal {
            total
            items {
              hs_object_id
            }
          }
        }
      }
    }
  }
`;