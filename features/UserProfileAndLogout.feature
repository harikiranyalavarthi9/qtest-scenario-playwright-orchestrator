Feature: User Profile and Logout
  As an authenticated user
  I want to view my profile and log out
  So that I can manage my session securely

  Background:
    Given the API is accessible

  Scenario: Authenticated user can view their profile
    Given I have a valid auth token
    When I use the expired token to access a protected resource
    Then the response status should be 200

  Scenario: Unauthenticated request to profile is rejected
    Given I have an expired auth token
    When I use the expired token to access a protected resource
    Then the response status should be 401
    And the response should contain error message "Token expired"

  Scenario: User can log out successfully
    Given I am authenticated and logged in
    When I log out
    Then the response status should be 200

  Scenario: Accessing dashboard after logout is rejected
    Given I am authenticated and logged in
    When I log out
    And I attempt to access a protected resource
    Then the response status should be 401
    And the response should contain error message "Your session has expired"