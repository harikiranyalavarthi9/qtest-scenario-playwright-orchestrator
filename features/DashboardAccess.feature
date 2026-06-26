Feature: Dashboard Access Control
  As an authenticated user
  I want to access the application dashboard
  So that I can view my data after logging in

  Background:
    Given the API is accessible

  Scenario: Authenticated user can access the dashboard
    Given I have valid user credentials
    When I send a login request with email "user@example.com" and password "SecurePass123"
    And I use the auth token to access the dashboard
    Then the response status should be 200
    And the response should contain page "dashboard"

  Scenario: Unauthenticated request to dashboard is rejected
    Given I have an expired auth token
    When I use the expired token to access a protected resource
    Then the response status should be 401
    And the response should contain error message "Your session has expired"

  Scenario: Accessing dashboard after logout is blocked
    Given I have valid user credentials
    When I send a login request with email "user@example.com" and password "SecurePass123"
    And I log out
    And I attempt to access a protected resource
    Then the response status should be 401
    And the response should contain error message "Your session has expired"

  Scenario: Dashboard is inaccessible with no token provided
    When I attempt to access the dashboard without a token
    Then the response status should be 401
    And the response should contain error message "Your session has expired"
