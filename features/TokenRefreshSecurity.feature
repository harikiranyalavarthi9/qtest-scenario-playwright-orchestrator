Feature: Token Refresh and Session Security
  As an authenticated user
  I want my session token to be rotated on refresh
  So that stolen tokens cannot be reused after a refresh

  Background:
    Given the API is accessible

  Scenario: Refreshing a valid token returns a new token
    Given I have a valid auth token
    When I send a refresh token request
    Then the response status should be 200
    And a new auth token should be returned
    And the new token should be different from the old one

  Scenario: Old token is revoked after refresh
    Given I have a valid auth token
    When I send a refresh token request
    And I attempt to access the dashboard using the old token
    Then the response status should be 401

  Scenario: New token grants access after refresh
    Given I have a valid auth token
    When I send a refresh token request
    And I access the dashboard using the new token
    Then the response status should be 200

  Scenario: Refreshing with no token is rejected
    When I send a refresh request without a token
    Then the response status should be 401
    And the response should contain error message "Invalid or expired token"

  Scenario: Refreshed session can be explicitly logged out
    Given I have a valid auth token
    When I send a refresh token request
    And I log out using the new token
    Then the response status should be 200
    And I attempt to access the dashboard using the new token
    Then the response status should be 401
