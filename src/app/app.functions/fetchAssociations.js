const axios = require('axios');

exports.main = async (context = {}) => {
  const { hs_object_id } = context.propertiesToSend;
  const token = process.env['PRIVATE_APP_ACCESS_TOKEN'];

  return await fetchAssociations(token, hs_object_id);
};

// Function to fetch associations for the deal by id
const fetchAssociations = async (token, id) => {
  const requestBody = {
    operationName: 'data',
    query: QUERY,
    variables: { id },
  };

  // Log the outgoing GraphQL request body
  console.log('GraphQL request body:', JSON.stringify(requestBody, null, 2));

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

    // Log the entire GraphQL response to help with debugging
    console.log('GraphQL response body:', JSON.stringify(responseBody, null, 2));

    // Check if there's an errors array returned by GraphQL
    if (responseBody.errors && responseBody.errors.length > 0) {
      console.error('GraphQL errors:', responseBody.errors);
      throw new Error(`GraphQL Error: ${JSON.stringify(responseBody.errors)}`);
    }

    // Check the structure of the response
    if (
      !responseBody.data ||
      !responseBody.data.CRM ||
      !responseBody.data.CRM.deal
    ) {
      console.error('Full response body:', JSON.stringify(responseBody, null, 2));
      throw new Error(
        'No CRM deal data returned. Verify that your deal ID is correct, and that you have necessary scopes.'
      );
    }

    // Return the data for the deal object
    return responseBody.data.CRM.deal;

  } catch (error) {
    console.error('Error fetching deal associations:', error.message);
    throw error;
  }
};

// Updated GraphQL query to fetch deal associations
const QUERY = `
  query data ($id: String!) {
    CRM {
      deal(uniqueIdentifier: "id", uniqueIdentifierValue: $id) {
        hs_object_id
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
          deal_collection__original_deal_cloned_deal {
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